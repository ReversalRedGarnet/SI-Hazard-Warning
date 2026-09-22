/**
 * Standalone role-check primitive, kept separate from ApprovalWorkflow so
 * "did this actor have the right role for this action" is always logged
 * the same way regardless of which piece of governance logic is asking —
 * docs/PROJECT_HANDOFF.md lists "role check" as its own auditable event
 * category, distinct from an approval decision or a send action.
 *
 * @param {import("./Role.js").User} user
 * @param {string[]} allowedRoles
 * @param {{ auditLog?: import("./AuditLog.js").AuditLog, action?: string, subject?: * }} [options]
 * @returns {true}
 * @throws {Error} if user.role isn't in allowedRoles
 */
export function assertRole(user, allowedRoles, { auditLog, action = "ROLE_CHECK", subject = null } = {}) {
  const permitted = allowedRoles.includes(user.role);

  if (auditLog) {
    auditLog.record({
      actorUserId: user.user_id,
      actorRole: user.role,
      action,
      subject,
      outcome: permitted ? "PERMITTED" : "DENIED",
      details: { allowedRoles },
    });
  }

  if (!permitted) {
    throw new Error(`User ${user.user_id} (role ${user.role}) is not permitted to perform "${action}"`);
  }

  return true;
}
