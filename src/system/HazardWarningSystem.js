import { DedupService } from "../normalization/dedup.js";
import { deriveLifecycleTransition } from "../normalization/lifecycle.js";
import { loadBoundaryDataset } from "../geo/boundaryDataset.js";
import { mapAlertToAdministrativeUnits } from "../geo/mapping.js";
import { resolveRecipientSubscribers, toRecipient } from "../subscribers/matching.js";
import { NotificationService } from "../distribution/NotificationService.js";
import { OutboundMessageStore } from "../distribution/OutboundMessageStore.js";
import { AuditLog } from "../governance/AuditLog.js";
import { requireEnvironmentMode } from "../governance/EnvironmentMode.js";
import { ApprovalWorkflow } from "../governance/ApprovalWorkflow.js";
import { RateLimiter } from "../governance/RateLimiter.js";
import { sendApproved, approvalSubjectFor } from "../governance/ApprovedSend.js";
import { computeSourceHealth, DEFAULT_EXPECTED_POLL_INTERVAL_MS } from "../ingestion/SourceHealth.js";

/**
 * Composes every stage built in prior work (ingestion, normalization/dedup,
 * geo mapping, subscriber resolution, governance, distribution) into one
 * object — closing the gap between "these modules each work and are each
 * tested in isolation" and "this is one real system." Nothing in this file
 * reimplements a stage; it only sequences calls to the existing modules and
 * owns the collaborators (NotificationService, ApprovalWorkflow, the
 * dedup/last-alert state, the shared AuditLog) that previously had to be
 * constructed and wired by hand in every test/caller.
 *
 * Public surface is deliberately small: ingestAndProcess() (ingestion through
 * candidate-recipient resolution), submitForApproval()/decideApproval()
 * (governance), sendApproved() (the only way to actually dispatch), and a
 * couple of read-only audit accessors. Everything else — the
 * NotificationService instance in particular, since that's what can
 * actually reach a provider — is a JS private (#) field: not just
 * undocumented or discouraged, but syntactically unreachable from outside
 * this class. There is no property, method, or reflection API that exposes
 * it; `system.notificationService` is `undefined` and no amount of
 * `Object.getOwnPropertyNames`/`Reflect` access can find it, because
 * private class fields aren't own properties at all in the way public ones
 * are. sendApproved() is the only method that reads that field.
 */
export class HazardWarningSystem {
  #notificationService;
  #approvalWorkflow;
  #rateLimiter;
  #auditLog;
  #dedupService;
  #subscriberStore;
  #boundaryDataset;
  #lastAlertByEventId;
  #environmentMode;
  #now;
  #expectedPollIntervalMs;
  #lastSuccessfulPollAt;
  #lastPollErrored;

  /**
   * @param {{
   *   hazardSource: import("../ingestion/HazardSource.js").HazardSource,
   *   provider: import("../distribution/SmsProvider.js").SmsProvider,
   *   subscriberStore: import("../subscribers/SubscriberStore.js").SubscriberStore,
   *   environmentMode: string,
   *   boundaryDataset?: { provenance: Object, units: import("../geo/AdministrativeUnit.js").AdministrativeUnit[] },
   *   auditLog?: AuditLog,
   *   dedupService?: DedupService,
   *   outboundMessageStore?: OutboundMessageStore,
   *   rateLimiter?: RateLimiter,
   *   now?: () => number,
   *   expectedPollIntervalMs?: number,
   * }} deps
   */
  constructor({
    hazardSource,
    provider,
    subscriberStore,
    environmentMode,
    boundaryDataset,
    auditLog,
    dedupService,
    outboundMessageStore,
    rateLimiter,
    now,
    expectedPollIntervalMs,
  }) {
    if (!hazardSource) throw new Error("HazardWarningSystem requires a hazardSource");
    if (!provider) throw new Error("HazardWarningSystem requires a provider");
    if (!subscriberStore) throw new Error("HazardWarningSystem requires a subscriberStore");

    this.hazardSource = hazardSource;
    this.#subscriberStore = subscriberStore;
    this.#environmentMode = requireEnvironmentMode(environmentMode);
    this.#boundaryDataset = boundaryDataset ?? loadBoundaryDataset();
    this.#auditLog = auditLog ?? new AuditLog();
    this.#dedupService = dedupService ?? new DedupService();
    this.#approvalWorkflow = new ApprovalWorkflow({ auditLog: this.#auditLog });
    this.#rateLimiter = rateLimiter ?? new RateLimiter();
    this.#lastAlertByEventId = new Map();

    this.#now = now ?? Date.now;
    this.#expectedPollIntervalMs = expectedPollIntervalMs ?? DEFAULT_EXPECTED_POLL_INTERVAL_MS;
    this.#lastSuccessfulPollAt = null;
    this.#lastPollErrored = false;

    const outboundStore = outboundMessageStore ?? new OutboundMessageStore();
    this.#notificationService = new NotificationService({
      provider,
      store: outboundStore,
      environmentMode: this.#environmentMode,
      auditLog: this.#auditLog,
    });
  }

  /**
   * Fetches fresh raw alerts from the configured HazardSource and runs each
   * through dedup/event-correlation, lifecycle classification, geo mapping,
   * and subscriber resolution — everything up to (but not including)
   * governance/dispatch. The doc's own field list describes this per-alert
   * result as "a normalized Alert + affected units + candidate recipients";
   * since one poll of a real feed can return several items (and even one
   * item's dedup/lifecycle outcome is worth surfacing per-item), this
   * returns an array of that shape, one entry per fetched alert, in the
   * order fetched.
   *
   * Naming note: the task that requested this described the method as
   * `ingestAndProcess(rawSource)`. There's no per-call `rawSource`
   * parameter here — "a configured HazardSource" is supplied once, at
   * construction (as the task's own composition list also says), and a
   * HazardSource already encapsulates "the raw source" (SIMSCAPAdapter
   * fetches and parses raw RSS/CAP XML internally). Interpreted the
   * parameter name as referring to that already-configured source rather
   * than a second, redundant per-call argument — flagged as a judgment
   * call, not a literal signature match.
   *
   * Also updates source-health tracking (see getSourceHealth()) and audit-
   * logs two categories of per-item problem, distinctly from each other and
   * from a normal successful result: an item the HazardSource itself
   * couldn't fetch/parse at all (action "INGESTION_ITEM_FAILURE" — a
   * malformed-data problem), and an alert that parsed fine but looks like a
   * replay of an already-expired warning (action "SUSPECTED_REPLAY" — a
   * suspicious-timing problem; see dedup.js's isSuspiciouslyStale()). A
   * total failure of the fetch itself (the HazardSource's own fetchAlerts()
   * rejecting, not a single bad item within it) is a third, harder case:
   * this method still lets that rejection propagate to the caller, after
   * first recording it for source-health purposes.
   *
   * @returns {Promise<Array<{
   *   alert: import("../normalization/Alert.js").Alert,
   *   isReissue: boolean,
   *   isSuspiciouslyStale: boolean,
   *   lifecycle: { state: string, sendTrigger: boolean, reasons: string[] },
   *   affectedUnits: import("../geo/AdministrativeUnit.js").AdministrativeUnit[],
   *   boundaryStatus: string|null,
   *   boundaryDatasetVersion: Object|null,
   *   candidateRecipients: { recipientId: string, phoneNumber: string }[],
   *   unresolvedZoneSubscribers: import("../subscribers/Subscriber.js").Subscriber[],
   * }>>}
   */
  async ingestAndProcess() {
    let fetchResult;
    try {
      fetchResult = await this.hazardSource.fetchAlerts();
      this.#lastSuccessfulPollAt = this.#now();
      this.#lastPollErrored = false;
    } catch (err) {
      this.#lastPollErrored = true;
      throw err;
    }

    const { alerts: rawAlerts, failures } = fetchResult;

    for (const failure of failures) {
      this.#auditLog.record({
        actorUserId: null,
        actorRole: null,
        action: "INGESTION_ITEM_FAILURE",
        subject: failure.url,
        outcome: "SKIPPED",
        details: failure,
      });
    }

    const results = [];

    for (const rawAlert of rawAlerts) {
      const { alert, isReissue, isSuspiciouslyStale } = this.#dedupService.ingest(rawAlert);

      if (isSuspiciouslyStale) {
        this.#auditLog.record({
          actorUserId: null,
          actorRole: null,
          action: "SUSPECTED_REPLAY",
          subject: alert.alert_id,
          outcome: "FLAGGED",
          details: { expires: alert.expires, retrieved_at: alert.retrieved_at },
        });
      }

      const previous = this.#lastAlertByEventId.get(alert.event_id) ?? null;
      const lifecycle = deriveLifecycleTransition(previous, alert);
      this.#lastAlertByEventId.set(alert.event_id, alert);

      const { affectedUnits, boundaryStatus, boundaryDatasetVersion } = mapAlertToAdministrativeUnits(
        alert,
        this.#boundaryDataset.units,
        { boundaryProvenance: this.#boundaryDataset.provenance },
      );

      const { recipients, unresolvedZoneSubscribers } = resolveRecipientSubscribers(
        affectedUnits,
        this.#subscriberStore.getAll(),
        this.#boundaryDataset.units,
      );

      results.push({
        alert,
        isReissue,
        isSuspiciouslyStale,
        lifecycle,
        affectedUnits,
        boundaryStatus,
        boundaryDatasetVersion,
        candidateRecipients: recipients.map(toRecipient),
        unresolvedZoneSubscribers,
      });
    }

    return results;
  }

  /**
   * docs/PROJECT_HANDOFF.md's "SOURCE INTERRUPTION" acceptance criterion:
   * lets a caller distinguish "the source has nothing new to say" from "we
   * don't currently know what the source would say" — see
   * src/ingestion/SourceHealth.js for the state definitions and threshold
   * reasoning. Computed fresh on every call from this instance's own
   * tracked poll history, using the injected clock (`now`, defaulting to
   * Date.now) rather than reading it once and caching it.
   *
   * @returns {string} One of SourceHealthStatus's values
   */
  getSourceHealth() {
    return computeSourceHealth({
      lastSuccessAt: this.#lastSuccessfulPollAt,
      lastAttemptErrored: this.#lastPollErrored,
      now: this.#now(),
      expectedPollIntervalMs: this.#expectedPollIntervalMs,
    });
  }

  /**
   * Submits a constructed message for approval under a given profile.
   * `subject` is computed the same way ApprovedSend.sendApproved() will
   * later recompute and check it — see approvalSubjectFor() — so callers
   * never have to (and can't accidentally mis-)construct that binding
   * themselves.
   *
   * @param {{ profileId: string, operator: import("../governance/Role.js").User, alertId: string, message: import("../distribution/messageConstruction.js").ConstructedMessage }} params
   */
  submitForApproval({ profileId, operator, alertId, message }) {
    return this.#approvalWorkflow.submit({ profileId, operator, subject: approvalSubjectFor(alertId, message) });
  }

  /**
   * @param {string} requestId
   * @param {import("../governance/Role.js").User} approver
   * @param {string} decision One of ApprovalDecision's values
   */
  decideApproval(requestId, approver, decision) {
    return this.#approvalWorkflow.decide(requestId, approver, decision);
  }

  /** @param {string} requestId */
  getApprovalRequest(requestId) {
    return this.#approvalWorkflow.getRequest(requestId);
  }

  /**
   * The only way to actually notify anyone through this system. Delegates
   * to ApprovedSend.sendApproved() with this instance's own ApprovalWorkflow,
   * private NotificationService, and rate limiter — a caller outside this
   * class has no way to reach the NotificationService directly, so every
   * send that happens through a HazardWarningSystem has necessarily passed
   * approval-status, approval-profile, approval-subject, and rate-limit
   * checks first.
   *
   * @param {{
   *   approvalRequestId: string,
   *   expectedProfileId: string,
   *   alertId: string,
   *   message: import("../distribution/messageConstruction.js").ConstructedMessage,
   *   channel: string,
   *   recipients: { recipientId: string, phoneNumber: string }[],
   *   triggeredBy: import("../governance/Role.js").User,
   * }} params
   */
  async sendApproved({ approvalRequestId, expectedProfileId, alertId, message, channel, recipients, triggeredBy }) {
    return sendApproved({
      approvalWorkflow: this.#approvalWorkflow,
      approvalRequestId,
      expectedProfileId,
      notificationService: this.#notificationService,
      alertId,
      message,
      channel,
      recipients,
      triggeredBy,
      rateLimiter: this.#rateLimiter,
    });
  }

  /** @returns {import("../governance/AuditLog.js").AuditLogEntry[]} */
  getAuditEntries() {
    return this.#auditLog.getEntries();
  }

  /** @returns {{ valid: true } | { valid: false, brokenAtSequence: number, reason: string }} */
  verifyAuditChain() {
    return this.#auditLog.verifyChain();
  }
}
