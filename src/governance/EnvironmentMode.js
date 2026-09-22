/**
 * docs/PROJECT_HANDOFF.md's operating-modes safety rail. The doc doesn't
 * spell out exact mode names, but "compromised admin account", "a source
 * outage misread as no warning", and the overall two-person-approval
 * framing all assume the system always knows, explicitly, whether it's
 * capable of reaching real people — so this has to be a required value the
 * system starts with, never an implicit default. Defaulting to PRODUCTION
 * on a missing/misconfigured value would be the worst failure direction
 * (a dev/test run could reach real subscribers); defaulting to anything
 * else on a missing value would just hide the same misconfiguration
 * differently. Both are why this throws instead of defaulting at all.
 */
export const EnvironmentMode = Object.freeze({
  DEVELOPMENT: "DEVELOPMENT",
  TEST: "TEST",
  PRODUCTION: "PRODUCTION",
});

export const ENVIRONMENT_MODE_ENV_VAR = "SI_HAZARD_WARNING_ENV_MODE";

/**
 * Validates a candidate environment mode value, throwing rather than
 * defaulting for anything missing or unrecognized. This is the single
 * choke point every environment-mode-consuming constructor (NotificationService,
 * below) should call, so "no silent default" is enforced once, not
 * re-implemented per call site.
 *
 * @param {*} rawValue
 * @returns {string} One of EnvironmentMode's values
 */
export function requireEnvironmentMode(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    throw new Error(
      `Environment mode is required and has no default. Pass one of: ${Object.values(EnvironmentMode).join(", ")} ` +
        `(or set ${ENVIRONMENT_MODE_ENV_VAR}).`,
    );
  }
  if (!Object.values(EnvironmentMode).includes(rawValue)) {
    throw new Error(`Invalid environment mode: "${rawValue}". Must be one of: ${Object.values(EnvironmentMode).join(", ")}`);
  }
  return rawValue;
}

/**
 * Reads and validates the environment mode from process.env, for callers
 * that want the "no silent default" guarantee applied to process
 * configuration specifically rather than an explicitly-passed value.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function resolveEnvironmentModeFromEnv(env = process.env) {
  return requireEnvironmentMode(env[ENVIRONMENT_MODE_ENV_VAR]);
}
