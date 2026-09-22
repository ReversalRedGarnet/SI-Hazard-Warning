/**
 * The swappable provider interface NotificationService depends on.
 * docs/PROJECT_HANDOFF.md: "Build a swappable provider layer, don't
 * hard-code a gateway." No real gateway is implemented here — no BudgetSMS
 * account exists yet — this defines the seam a real provider (BudgetSMS,
 * D7, ...) would implement later, exercised for now by MockSMSProvider.
 */
export class SmsProvider {
  /** @returns {string} Name recorded in OutboundMessage.provider */
  get providerName() {
    throw new Error("providerName not implemented");
  }

  /**
   * Submits one message to the gateway. Must resolve to a definite
   * accept/reject outcome, or throw GatewayTimeoutError if the gateway's
   * response is unknown (network timeout, etc.) — that distinction is
   * what NotificationService's retry/idempotency logic keys off, so a real
   * provider implementation must not collapse "rejected" and "no response"
   * into the same outcome.
   *
   * @param {{ phoneNumber: string }} recipient
   * @param {string} text
   * @returns {Promise<{ accepted: boolean, providerMessageId: string|null, failureReason: string|null }>}
   */
  async send(recipient, text) {
    throw new Error("send not implemented");
  }
}

/**
 * Thrown when a provider call's outcome is genuinely unknown — the gateway
 * may or may not have accepted the message. Distinct from a normal
 * rejection (invalid number, gateway-side failure with a definite answer),
 * which a provider should resolve, not throw.
 */
export class GatewayTimeoutError extends Error {
  constructor(message = "Gateway did not respond in time") {
    super(message);
    this.name = "GatewayTimeoutError";
  }
}
