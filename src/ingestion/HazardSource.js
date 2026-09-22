/**
 * Contract every hazard source adapter implements. Kept intentionally thin —
 * source health tracking, retries and the lifecycle state machine belong to
 * the normalization stage, not to individual adapters.
 */
export class HazardSource {
  /** @returns {string} Name recorded in Alert.source */
  get sourceName() {
    throw new Error("sourceName not implemented");
  }

  /** @returns {Promise<import("../normalization/Alert.js").Alert[]>} */
  async fetchAlerts() {
    throw new Error("fetchAlerts not implemented");
  }
}
