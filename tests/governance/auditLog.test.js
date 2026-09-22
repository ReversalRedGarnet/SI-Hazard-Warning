import { describe, it, expect } from "vitest";
import { AuditLog } from "../../src/governance/AuditLog.js";

describe("AuditLog", () => {
  it("records who/what/when/outcome for each entry", () => {
    const log = new AuditLog();
    const entry = log.record({
      actorUserId: "user-1",
      actorRole: "OPERATOR",
      action: "SEND",
      subject: "alert-1",
      outcome: "ACCEPTED",
      details: { note: "test" },
      at: "2026-09-22T00:00:00Z",
    });

    expect(entry.actor_user_id).toBe("user-1");
    expect(entry.actor_role).toBe("OPERATOR");
    expect(entry.action).toBe("SEND");
    expect(entry.subject).toBe("alert-1");
    expect(entry.outcome).toBe("ACCEPTED");
    expect(entry.timestamp).toBe("2026-09-22T00:00:00Z");
    expect(entry.sequence).toBe(0);
    expect(entry.entry_hash).toBeTruthy();
  });

  it("chains each entry's prev_hash to the previous entry's entry_hash", () => {
    const log = new AuditLog();
    const first = log.record({ actorUserId: "u1", actorRole: "OPERATOR", action: "A", outcome: "OK" });
    const second = log.record({ actorUserId: "u2", actorRole: "APPROVER", action: "B", outcome: "OK" });

    expect(second.prev_hash).toBe(first.entry_hash);
    expect(first.prev_hash).toBe("0".repeat(64)); // genesis
  });

  it("verifyChain() passes for an untouched log, including an empty one", () => {
    const empty = new AuditLog();
    expect(empty.verifyChain()).toEqual({ valid: true });

    const log = new AuditLog();
    log.record({ actorUserId: "u1", actorRole: "OPERATOR", action: "A", outcome: "OK" });
    log.record({ actorUserId: "u2", actorRole: "APPROVER", action: "B", outcome: "OK" });
    log.record({ actorUserId: "u3", actorRole: "ADMINISTRATOR", action: "C", outcome: "OK" });

    expect(log.verifyChain()).toEqual({ valid: true });
  });

  it("detects an entry whose own content was altered after the fact", () => {
    const log = new AuditLog();
    log.record({ actorUserId: "u1", actorRole: "OPERATOR", action: "APPROVAL_DECISION", subject: "req-1", outcome: "REJECT" });
    log.record({ actorUserId: "u2", actorRole: "APPROVER", action: "SEND", subject: "req-1", outcome: "ACCEPTED" });

    // Simulate tampering: rewrite entry 0's outcome from REJECT to APPROVE
    // without recomputing its hash — this is what a backing-store edit
    // would look like, since entries are frozen and can't be mutated
    // in place (Object.freeze + strict mode throws on that).
    log.entries[0] = { ...log.entries[0], outcome: "APPROVE" };

    const result = log.verifyChain();
    expect(result.valid).toBe(false);
    expect(result.brokenAtSequence).toBe(0);
  });

  it("detects a broken prev_hash link (e.g. an entry spliced out of the middle)", () => {
    const log = new AuditLog();
    log.record({ actorUserId: "u1", actorRole: "OPERATOR", action: "A", outcome: "OK" });
    log.record({ actorUserId: "u2", actorRole: "APPROVER", action: "B", outcome: "OK" });
    log.record({ actorUserId: "u3", actorRole: "ADMINISTRATOR", action: "C", outcome: "OK" });

    log.entries.splice(1, 1); // remove the middle entry; sequence 2's prev_hash now points at a hash that no longer precedes it

    const result = log.verifyChain();
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/prev_hash/);
  });

  it("frozen entries can't be mutated in place (defense in depth, not the only tamper-detection mechanism)", () => {
    // ES modules run in strict mode, where assigning to a frozen object's
    // property throws instead of silently no-op'ing.
    const log = new AuditLog();
    const entry = log.record({ actorUserId: "u1", actorRole: "OPERATOR", action: "A", outcome: "OK" });
    expect(() => {
      entry.outcome = "TAMPERED";
    }).toThrow();
  });

  it("getEntries() returns a copy, not a reference to the internal array", () => {
    const log = new AuditLog();
    log.record({ actorUserId: "u1", actorRole: "OPERATOR", action: "A", outcome: "OK" });
    const copy = log.getEntries();
    copy.push({ fabricated: true });
    expect(log.getEntries()).toHaveLength(1);
  });
});
