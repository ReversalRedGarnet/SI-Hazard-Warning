import { describe, it, expect, beforeAll } from "vitest";
import { verifyCapSignature, CapSignatureStatus } from "../../src/shared/capSignature.js";
import { generateTestKeyPair, signCapXml, TEST_CAP_XML } from "./capSignatureFixtures.js";

/**
 * Audit finding H3. These test against signatures this codebase generates
 * and verifies end-to-end with a real, audited library (xml-crypto) — not
 * against the live SIMS/Alert Hub feed's own signatures, which the
 * investigation recorded in SIMSCAPAdapter.js's module comment found do
 * not verify under standard XML-DSig canonicalization regardless of which
 * key is used. That's a separate, reported finding — this file proves the
 * verification *mechanism itself* is correct.
 */
describe("verifyCapSignature", () => {
  /** @type {{ publicKey: string, privateKey: string }} */
  let keyPair;
  let signedXml;

  beforeAll(() => {
    keyPair = generateTestKeyPair();
    signedXml = signCapXml(TEST_CAP_XML, keyPair.privateKey);
  });

  it("passes for a validly-signed payload verified against the correct trusted key", () => {
    const result = verifyCapSignature(signedXml, { trustedCertPem: keyPair.publicKey });
    expect(result).toEqual({ status: CapSignatureStatus.VALID, reason: null });
  });

  it("fails for a tampered payload — same structure, one field's content altered post-signing", () => {
    expect(signedXml).toContain("Severe");
    const tampered = signedXml.replace("Severe", "Extreme");

    const result = verifyCapSignature(tampered, { trustedCertPem: keyPair.publicKey });
    expect(result.status).toBe(CapSignatureStatus.INVALID);
    expect(result.reason).toBeTruthy();
  });

  it("rejects a payload with no signature at all, rather than silently treating it as trusted", () => {
    const result = verifyCapSignature(TEST_CAP_XML, { trustedCertPem: keyPair.publicKey });
    expect(result.status).toBe(CapSignatureStatus.MISSING);
    expect(result.status).not.toBe(CapSignatureStatus.VALID);
  });

  it("fails when the signature verifies against a different key than the one that actually signed it", () => {
    // This is the specific attack the module comment names: a forged
    // payload could carry its own correctly-self-signed certificate, so
    // verification must be pinned to a key the caller supplies, not
    // whatever is embedded in the payload — proven here by supplying a
    // *different*, unrelated key pair's public key as the pin.
    const otherKeyPair = generateTestKeyPair();
    const result = verifyCapSignature(signedXml, { trustedCertPem: otherKeyPair.publicKey });
    expect(result.status).toBe(CapSignatureStatus.INVALID);
  });

  it("throws rather than silently skipping when no trustedCertPem is supplied", () => {
    expect(() => verifyCapSignature(signedXml, {})).toThrow(/requires trustedCertPem/);
  });

  it("returns INVALID (not a thrown exception) for XML that doesn't parse at all", () => {
    const result = verifyCapSignature("<not valid xml", { trustedCertPem: keyPair.publicKey });
    expect(result.status).toBe(CapSignatureStatus.INVALID);
  });
});
