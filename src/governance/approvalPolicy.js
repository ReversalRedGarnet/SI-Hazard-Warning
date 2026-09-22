import { Role } from "./Role.js";

/**
 * docs/PROJECT_HANDOFF.md: "Approval isn't one-size-fits-all — define
 * profiles with the actual authorities rather than assuming uniform
 * two-person review: a trusted official relay (fast), a
 * transformed/localized message (needs review), and a manually authored
 * emergency message (needs the strongest approval)."
 *
 * The doc names these three by description, not by exact policy numbers —
 * requiredApprovals and eligibleApproverRoles below are this stage's
 * concrete interpretation, flagged as a judgment call:
 *  - TRUSTED_OFFICIAL_RELAY: content is a verbatim official warning being
 *    relayed, not authored or altered — "fast" is modeled as needing only
 *    one sign-off, and (uniquely among the three) an Operator is allowed to
 *    provide it, since there's no transformation to independently check.
 *  - TRANSFORMED_LOCALIZED_MESSAGE: content passed through
 *    templating/localization (see src/distribution/messageConstruction.js)
 *    — "needs review" is modeled as one sign-off, but strictly from an
 *    Approver/Administrator, not the Operator role generally, since the
 *    point is an independent check on the transformation.
 *  - MANUAL_EMERGENCY_MESSAGE: hand-authored content with no
 *    official-source relay to fall back on — "the strongest approval" is
 *    modeled as the doc's default two-person rule, both from
 *    Approver/Administrator.
 *
 * Every profile is still subject to the one rule that isn't
 * profile-specific: the operator can never be counted as one of their own
 * approvers, regardless of role (see ApprovalWorkflow.js) — that's not
 * expressed here because it isn't a per-profile choice, it's a structural
 * rule applied to all of them.
 */
export const ApprovalProfile = Object.freeze({
  TRUSTED_OFFICIAL_RELAY: "TRUSTED_OFFICIAL_RELAY",
  TRANSFORMED_LOCALIZED_MESSAGE: "TRANSFORMED_LOCALIZED_MESSAGE",
  MANUAL_EMERGENCY_MESSAGE: "MANUAL_EMERGENCY_MESSAGE",
});

/**
 * @typedef {Object} ApprovalPolicy
 * @property {number} requiredApprovals
 * @property {string[]} eligibleApproverRoles
 */

/** @type {Record<string, ApprovalPolicy>} */
const POLICIES = Object.freeze({
  [ApprovalProfile.TRUSTED_OFFICIAL_RELAY]: Object.freeze({
    requiredApprovals: 1,
    eligibleApproverRoles: Object.freeze([Role.OPERATOR, Role.APPROVER, Role.ADMINISTRATOR]),
  }),
  [ApprovalProfile.TRANSFORMED_LOCALIZED_MESSAGE]: Object.freeze({
    requiredApprovals: 1,
    eligibleApproverRoles: Object.freeze([Role.APPROVER, Role.ADMINISTRATOR]),
  }),
  [ApprovalProfile.MANUAL_EMERGENCY_MESSAGE]: Object.freeze({
    requiredApprovals: 2,
    eligibleApproverRoles: Object.freeze([Role.APPROVER, Role.ADMINISTRATOR]),
  }),
});

/**
 * @param {string} profileId One of ApprovalProfile's values
 * @returns {ApprovalPolicy}
 */
export function getApprovalPolicy(profileId) {
  const policy = POLICIES[profileId];
  if (!policy) throw new Error(`Unknown approval profile: ${profileId}`);
  return policy;
}
