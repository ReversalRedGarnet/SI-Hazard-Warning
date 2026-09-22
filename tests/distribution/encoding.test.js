import { describe, it, expect } from "vitest";
import { detectEncoding, computeSegments, Encoding } from "../../src/distribution/encoding.js";

describe("detectEncoding", () => {
  it("detects plain ASCII as GSM-7", () => {
    expect(detectEncoding("CYCLONE WARNING near Western Province.")).toBe(Encoding.GSM_7);
  });

  it("detects GSM-7 basic-charset accented characters as GSM-7, not UCS-2", () => {
    expect(detectEncoding("Café")).toBe(Encoding.GSM_7); // é is in the GSM-7 basic set
  });

  it("counts an extension-table character (e.g. €) as 2 septets", () => {
    const { characterCount, segments } = computeSegments("100€", Encoding.GSM_7);
    // "100" = 3 septets + "€" = 2 septets = 5
    expect(characterCount).toBe(5);
    expect(segments).toBe(1);
  });

  it("detects a character outside the GSM-7 tables (e.g. a curly apostrophe) as UCS-2", () => {
    expect(detectEncoding("Don’t")).toBe(Encoding.UCS_2);
  });
});

describe("computeSegments", () => {
  it("is 1 segment at exactly the GSM-7 single-segment limit (160)", () => {
    const text = "a".repeat(160);
    expect(computeSegments(text).segments).toBe(1);
  });

  it("is 2 segments one character past the GSM-7 single-segment limit", () => {
    const text = "a".repeat(161);
    const result = computeSegments(text);
    expect(result.segments).toBe(2);
    expect(result.encoding).toBe(Encoding.GSM_7);
  });

  it("is 1 segment at exactly the UCS-2 single-segment limit (70)", () => {
    const text = "’".repeat(70);
    expect(computeSegments(text).segments).toBe(1);
  });

  it("is 2 segments one character past the UCS-2 single-segment limit", () => {
    const text = "’".repeat(71);
    const result = computeSegments(text);
    expect(result.segments).toBe(2);
    expect(result.encoding).toBe(Encoding.UCS_2);
  });
});
