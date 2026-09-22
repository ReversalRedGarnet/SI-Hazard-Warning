/**
 * Contract every hazard source adapter implements. Kept intentionally thin —
 * source health *tracking over time* (docs/PROJECT_HANDOFF.md's
 * SOURCE INTERRUPTION criterion), retries and the lifecycle state machine
 * belong to the normalization/system stages, not to individual adapters.
 * The one thing this contract does ask of an adapter — reporting a
 * per-item failure without losing the rest of a batch (see
 * SIMSCAPAdapter.fetchAlerts()) — is about isolating *this poll's* partial
 * failures, not about tracking health across polls; a caller (e.g.
 * HazardWarningSystem) still needs to know whether the fetch attempt as a
 * whole succeeded or threw to track health over time.
 */
export class HazardSource {
  /** @returns {string} Name recorded in Alert.source */
  get sourceName() {
    throw new Error("sourceName not implemented");
  }

  /**
   * @returns {Promise<{
   *   alerts: import("../normalization/Alert.js").Alert[],
   *   failures: Array<{ url: string, error: string, occurredAt: string }>,
   * }>}
   */
  async fetchAlerts() {
    throw new Error("fetchAlerts not implemented");
  }
}
