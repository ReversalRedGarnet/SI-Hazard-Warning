import { describe, it, expect } from "vitest";
import {
  EnvironmentMode,
  requireEnvironmentMode,
  resolveEnvironmentModeFromEnv,
  ENVIRONMENT_MODE_ENV_VAR,
} from "../../src/governance/EnvironmentMode.js";

describe("requireEnvironmentMode", () => {
  it("returns the value unchanged when it's a valid mode", () => {
    expect(requireEnvironmentMode(EnvironmentMode.PRODUCTION)).toBe("PRODUCTION");
    expect(requireEnvironmentMode(EnvironmentMode.TEST)).toBe("TEST");
    expect(requireEnvironmentMode(EnvironmentMode.DEVELOPMENT)).toBe("DEVELOPMENT");
  });

  it("throws rather than defaulting when the value is missing", () => {
    expect(() => requireEnvironmentMode(undefined)).toThrow();
    expect(() => requireEnvironmentMode(null)).toThrow();
    expect(() => requireEnvironmentMode("")).toThrow();
  });

  it("throws — and does not quietly coerce — an unrecognized value", () => {
    expect(() => requireEnvironmentMode("production")).toThrow(); // wrong case is not accepted silently
    expect(() => requireEnvironmentMode("STAGING")).toThrow();
  });

  it("never treats a missing value as PRODUCTION specifically", () => {
    // The one failure direction the doc explicitly worries about: silently
    // becoming capable of reaching real people. Asserting the error message
    // doesn't happen to mention PRODUCTION as if it were the resolved value.
    try {
      requireEnvironmentMode(undefined);
      throw new Error("expected requireEnvironmentMode to throw");
    } catch (err) {
      expect(err.message).not.toMatch(/defaulted to PRODUCTION/i);
    }
  });
});

describe("resolveEnvironmentModeFromEnv", () => {
  it("reads a valid mode from the given env-like object", () => {
    expect(resolveEnvironmentModeFromEnv({ [ENVIRONMENT_MODE_ENV_VAR]: "TEST" })).toBe("TEST");
  });

  it("throws when the env var is absent", () => {
    expect(() => resolveEnvironmentModeFromEnv({})).toThrow();
  });
});
