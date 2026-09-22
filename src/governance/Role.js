/**
 * docs/PROJECT_HANDOFF.md, "Governance, security & operating modes":
 * "Roles: Viewer / Operator / Approver / Administrator, with two-person
 * approval for any public broadcast — an operator can't approve their own
 * send."
 *
 * This is deliberately not mapped to any real named person or office at
 * SIMS/NDMO/SIG ICT — the doc says that's confirmed later. This is just the
 * mechanism the mapping will eventually plug into.
 */
export const Role = Object.freeze({
  /** Read-only access — can view alerts/status, never submit, approve, or send. */
  VIEWER: "VIEWER",
  /** Can submit/relay alerts and construct messages, but never approve their own send (see ApprovalWorkflow.js). */
  OPERATOR: "OPERATOR",
  /** Can approve a pending send that isn't their own. */
  APPROVER: "APPROVER",
  /** Superset of Approver for approval purposes; also the role most later admin-only actions (not built here) would gate on. */
  ADMINISTRATOR: "ADMINISTRATOR",
});

/**
 * @typedef {Object} User
 * @property {string} user_id
 * @property {string} role          One of Role's values
 * @property {string|null} display_name  Optional, human-readable — not personal/subscriber data, this is an internal operator account
 */

const REQUIRED_FIELDS = ["user_id", "role"];

/**
 * Minimal User model — this is not a full auth system (no credentials,
 * sessions, or MFA here; docs/PROJECT_HANDOFF.md calls MFA out as a
 * separate, later infra pass). Just enough identity to attach a role to an
 * action and to an audit log entry.
 *
 * @param {Partial<User>} fields
 * @returns {Readonly<User>}
 */
export function createUser(fields) {
  for (const key of REQUIRED_FIELDS) {
    if (fields[key] === undefined || fields[key] === null) {
      throw new Error(`User is missing required field: ${key}`);
    }
  }
  if (!Object.values(Role).includes(fields.role)) {
    throw new Error(`User has invalid role: ${fields.role}`);
  }

  return Object.freeze({
    user_id: fields.user_id,
    role: fields.role,
    display_name: fields.display_name ?? null,
  });
}
