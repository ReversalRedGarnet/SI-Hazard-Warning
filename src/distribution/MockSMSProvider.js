import { SmsProvider, GatewayTimeoutError } from "./SmsProvider.js";

/**
 * A deterministic stand-in SMS provider for tests — no real gateway
 * account exists yet, so this is what BudgetSMSProvider/D7Provider will
 * eventually replace. "Deterministic" means: outcomes are scripted up
 * front, not randomized, so a test can force an exact sequence (e.g.
 * timeout, then accept on retry) and assert on it reliably.
 */
export class MockSMSProvider extends SmsProvider {
  /**
   * @param {{
   *   script?: Array<{ type: "accept"|"reject"|"timeout", providerMessageId?: string, failureReason?: string, message?: string }>,
   *   defaultOutcome?: { type: "accept"|"reject"|"timeout" },
   * }} [options]
   */
  constructor(options = {}) {
    super();
    this.script = [...(options.script ?? [])];
    this.defaultOutcome = options.defaultOutcome ?? { type: "accept" };
    /** @type {{ recipient: { phoneNumber: string }, text: string }[]} */
    this.callLog = [];
    this._messageIdCounter = 0;
  }

  get providerName() {
    return "MockSMS";
  }

  async send(recipient, text) {
    this.callLog.push({ recipient, text });
    const outcome = this.script.length > 0 ? this.script.shift() : this.defaultOutcome;

    if (outcome.type === "timeout") {
      throw new GatewayTimeoutError(outcome.message);
    }

    if (outcome.type === "reject") {
      return { accepted: false, providerMessageId: null, failureReason: outcome.failureReason ?? "rejected by gateway" };
    }

    this._messageIdCounter += 1;
    return {
      accepted: true,
      providerMessageId: outcome.providerMessageId ?? `mock-${this._messageIdCounter}`,
      failureReason: null,
    };
  }
}
