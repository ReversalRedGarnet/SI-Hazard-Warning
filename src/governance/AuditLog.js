import { sha256Hex } from "../shared/hash.js";

/**
 * Hash-chained, append-only audit log. docs/PROJECT_HANDOFF.md: "Immutable
 * audit log... every approval decision, role check, and send action gets
 * an append-only, tamper-evident record." Hash-chaining (each entry's hash
 * covers the previous entry's hash, like a minimal blockchain/git-commit
 * structure) is enough to make tampering *detectable* after the fact —
 * this is explicitly not real cryptographic signing/attestation
 * infrastructure (no external anchor, no per-actor signing key), which the
 * doc treats as separate, later infra work alongside MFA/encryption.
 *
 * "Append-only" is enforced by convention here (only `record()` mutates
 * `entries`, and each entry is frozen), not by a storage-layer guarantee —
 * a real deployment needs this backed by a write-once store (or at least
 * one where `verifyChain()` runs as a standing integrity check). The
 * in-memory array itself could still be spliced directly by other code in
 * the same process; the hash chain is what makes that show up in
 * verifyChain() rather than what makes it impossible.
 */

const GENESIS_HASH = "0".repeat(64);

/**
 * @typedef {Object} AuditLogEntry
 * @property {number} sequence
 * @property {string} timestamp        ISO 8601
 * @property {string|null} actor_user_id
 * @property {string|null} actor_role
 * @property {string} action           e.g. "APPROVAL_DECISION", "ROLE_CHECK", "SEND"
 * @property {*} subject               Free-form: whatever the action was about (alert id, approval request id, outbound message idempotency key, ...)
 * @property {string} outcome          Free-form outcome label (e.g. "APPROVED", "DENIED", "ACCEPTED")
 * @property {Object} details          Free-form extra context
 * @property {string} prev_hash        entry_hash of the previous entry, or GENESIS_HASH for the first
 * @property {string} entry_hash       sha256 over this entry's own fields + prev_hash
 */

function hashableFields(entry) {
  // Deliberately excludes entry_hash itself — that's the output, not an input.
  return JSON.stringify({
    sequence: entry.sequence,
    timestamp: entry.timestamp,
    actor_user_id: entry.actor_user_id,
    actor_role: entry.actor_role,
    action: entry.action,
    subject: entry.subject,
    outcome: entry.outcome,
    details: entry.details,
    prev_hash: entry.prev_hash,
  });
}

export class AuditLog {
  constructor() {
    /** @type {AuditLogEntry[]} */
    this.entries = [];
  }

  /**
   * Appends one entry to the chain. `at` lets tests pin a timestamp; real
   * callers should omit it and get wall-clock time.
   *
   * @param {{
   *   actorUserId: string|null,
   *   actorRole: string|null,
   *   action: string,
   *   subject?: *,
   *   outcome: string,
   *   details?: Object,
   *   at?: string,
   * }} params
   * @returns {Readonly<AuditLogEntry>}
   */
  record({ actorUserId, actorRole, action, subject = null, outcome, details = {}, at }) {
    const previous = this.entries[this.entries.length - 1];
    const prevHash = previous ? previous.entry_hash : GENESIS_HASH;

    const partial = {
      sequence: this.entries.length,
      timestamp: at ?? new Date().toISOString(),
      actor_user_id: actorUserId,
      actor_role: actorRole,
      action,
      subject,
      outcome,
      details,
      prev_hash: prevHash,
    };

    const entry = Object.freeze({ ...partial, entry_hash: sha256Hex(hashableFields(partial)) });
    this.entries.push(entry);
    return entry;
  }

  /** @returns {AuditLogEntry[]} */
  getEntries() {
    return [...this.entries];
  }

  /**
   * Walks the chain and confirms every entry's prev_hash matches the prior
   * entry's entry_hash, and every entry's entry_hash still matches what its
   * own fields hash to. Either kind of mismatch means something was altered
   * or removed after the fact — this doesn't say *what* changed beyond the
   * sequence number, only *that* something did.
   *
   * @returns {{ valid: true } | { valid: false, brokenAtSequence: number, reason: string }}
   */
  verifyChain() {
    let expectedPrevHash = GENESIS_HASH;

    for (const entry of this.entries) {
      if (entry.prev_hash !== expectedPrevHash) {
        return { valid: false, brokenAtSequence: entry.sequence, reason: "prev_hash does not match the preceding entry's hash" };
      }
      const recomputed = sha256Hex(hashableFields(entry));
      if (recomputed !== entry.entry_hash) {
        return { valid: false, brokenAtSequence: entry.sequence, reason: "entry_hash does not match this entry's own recomputed hash (content was altered)" };
      }
      expectedPrevHash = entry.entry_hash;
    }

    return { valid: true };
  }
}
