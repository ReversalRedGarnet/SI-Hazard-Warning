/**
 * In-memory OutboundMessage store, keyed by idempotency_key. A real
 * deployment needs this backed by persistent storage (the whole point of
 * idempotency_key being a pure hash of stable inputs is that a persistent
 * store could recompute it and find the same row after a restart) — this
 * prototype only needs to prove NotificationService's dedup logic works.
 */
export class OutboundMessageStore {
  constructor() {
    /** @type {Map<string, import("./OutboundMessage.js").OutboundMessage>} */
    this.byIdempotencyKey = new Map();
  }

  /**
   * @param {string} idempotencyKey
   * @returns {import("./OutboundMessage.js").OutboundMessage|null}
   */
  findByIdempotencyKey(idempotencyKey) {
    return this.byIdempotencyKey.get(idempotencyKey) ?? null;
  }

  /**
   * Upserts by idempotency_key — a later save() with the same key replaces
   * the record (used for both status transitions and retries), it never
   * appends a second row for the same key.
   *
   * @param {import("./OutboundMessage.js").OutboundMessage} message
   */
  save(message) {
    this.byIdempotencyKey.set(message.idempotency_key, message);
  }

  /** @returns {import("./OutboundMessage.js").OutboundMessage[]} */
  getAll() {
    return [...this.byIdempotencyKey.values()];
  }
}
