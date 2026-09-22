/**
 * In-memory Subscriber store, keyed by subscriber_id. Mirrors
 * src/distribution/OutboundMessageStore.js's pattern — this prototype only
 * needs enough persistence to prove the registration and matching logic
 * work; a real deployment needs this backed by a real database, and never
 * with real subscriber data checked into this repo (docs/PROJECT_HANDOFF.md:
 * "Never put real numbers, test data or gateway credentials into GitHub").
 */
export class SubscriberStore {
  constructor() {
    /** @type {Map<string, import("./Subscriber.js").Subscriber>} */
    this.bySubscriberId = new Map();
  }

  /** @param {import("./Subscriber.js").Subscriber} subscriber */
  save(subscriber) {
    this.bySubscriberId.set(subscriber.subscriber_id, subscriber);
  }

  /**
   * @param {string} subscriberId
   * @returns {import("./Subscriber.js").Subscriber|null}
   */
  findById(subscriberId) {
    return this.bySubscriberId.get(subscriberId) ?? null;
  }

  /** @returns {import("./Subscriber.js").Subscriber[]} */
  getAll() {
    return [...this.bySubscriberId.values()];
  }
}
