import { describe, it, expect } from "vitest";
import { Role, createUser } from "../../src/governance/Role.js";

describe("createUser", () => {
  it("creates a user with a valid role", () => {
    const user = createUser({ user_id: "user-1", role: Role.OPERATOR });
    expect(user.user_id).toBe("user-1");
    expect(user.role).toBe(Role.OPERATOR);
    expect(user.display_name).toBeNull();
  });

  it("accepts an optional display_name", () => {
    const user = createUser({ user_id: "user-2", role: Role.APPROVER, display_name: "Test Approver" });
    expect(user.display_name).toBe("Test Approver");
  });

  it("throws for a missing user_id", () => {
    expect(() => createUser({ role: Role.VIEWER })).toThrow();
  });

  it("throws for an invalid role", () => {
    expect(() => createUser({ user_id: "user-3", role: "SUPERUSER" })).toThrow();
  });

  it("exposes exactly the four roles the doc names", () => {
    expect(Object.values(Role).sort()).toEqual(["ADMINISTRATOR", "APPROVER", "OPERATOR", "VIEWER"].sort());
  });
});
