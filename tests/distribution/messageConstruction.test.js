import { describe, it, expect } from "vitest";
import { buildMessage, approveMessage, ConstructionStatus } from "../../src/distribution/messageConstruction.js";
import { Encoding } from "../../src/distribution/encoding.js";

const BASE_VARIABLES = {
  hazardType: "Strong Wind",
  severity: "Severe",
  province: "Western Province",
  time: "4pm today",
  instruction: "Move to higher ground and secure loose property.",
  infoLink: "met.gov.sb",
};

describe("buildMessage", () => {
  it("round-trips the same template through English and Pijin", () => {
    const en = buildMessage({ templateId: "hazard-warning", language: "en", variables: BASE_VARIABLES });
    const pis = buildMessage({ templateId: "hazard-warning", language: "pis", variables: BASE_VARIABLES });

    expect(en.text).toContain("Strong Wind");
    expect(en.text).toContain("Western Province");
    expect(en.language).toBe("en");
    expect(en.status).toBe(ConstructionStatus.PENDING_APPROVAL);

    expect(pis.text).toContain("Strong Wind");
    expect(pis.text).toContain("Western Province");
    expect(pis.language).toBe("pis");
    expect(pis.status).toBe(ConstructionStatus.PENDING_APPROVAL);

    // Different human-authored strings, not one derived from the other.
    expect(pis.text).not.toBe(en.text);
  });

  it("rejects a plain-ASCII message that's simply too long for its segment budget", () => {
    const built = buildMessage({
      templateId: "hazard-warning",
      language: "en",
      variables: {
        ...BASE_VARIABLES,
        instruction:
          "Move to higher ground immediately and secure all loose property before conditions worsen further this evening.",
      },
    });

    expect(built.encoding).toBe(Encoding.GSM_7);
    expect(built.segments).toBeGreaterThan(1);
    expect(built.status).toBe(ConstructionStatus.REJECTED_SEGMENT_BUDGET);
  });

  it("rejects when a single Unicode character silently doubles the per-segment cost", () => {
    // Identical text except one character: a curly apostrophe (U+2019)
    // instead of a straight one. That alone flips GSM-7 -> UCS-2, cutting
    // the single-segment budget from 160 chars to 70 — exactly the
    // scenario docs/PROJECT_HANDOFF.md calls out by name.
    const variables = { ...BASE_VARIABLES, province: "Western", time: "4pm", instruction: "travel by sea today." };

    const straightApostrophe = buildMessage({
      templateId: "hazard-warning",
      language: "en",
      variables: { ...variables, instruction: "Don't travel by sea today." },
    });
    const curlyApostrophe = buildMessage({
      templateId: "hazard-warning",
      language: "en",
      variables: { ...variables, instruction: "Don’t travel by sea today." },
    });

    expect(straightApostrophe.text.length).toBe(curlyApostrophe.text.length);
    expect(straightApostrophe.encoding).toBe(Encoding.GSM_7);
    expect(straightApostrophe.segments).toBe(1);
    expect(straightApostrophe.status).toBe(ConstructionStatus.PENDING_APPROVAL);

    expect(curlyApostrophe.encoding).toBe(Encoding.UCS_2);
    expect(curlyApostrophe.segments).toBeGreaterThan(1);
    expect(curlyApostrophe.status).toBe(ConstructionStatus.REJECTED_SEGMENT_BUDGET);
  });

  it("throws for an unknown template or a missing variable, rather than silently sending bad content", () => {
    expect(() => buildMessage({ templateId: "does-not-exist", language: "en", variables: {} })).toThrow();
    expect(() =>
      buildMessage({ templateId: "hazard-warning", language: "en", variables: { hazardType: "Strong Wind" } }),
    ).toThrow();
  });
});

describe("approveMessage", () => {
  it("approves a PENDING_APPROVAL message", () => {
    const built = buildMessage({ templateId: "hazard-warning", language: "en", variables: BASE_VARIABLES });
    const approved = approveMessage(built);
    expect(approved.status).toBe(ConstructionStatus.APPROVED);
  });

  it("refuses to approve a message rejected for exceeding its segment budget", () => {
    const built = buildMessage({
      templateId: "hazard-warning",
      language: "en",
      variables: { ...BASE_VARIABLES, instruction: "Don’t travel by sea today, tomorrow, or the day after that either." },
    });
    expect(built.status).toBe(ConstructionStatus.REJECTED_SEGMENT_BUDGET);
    expect(() => approveMessage(built)).toThrow();
  });
});
