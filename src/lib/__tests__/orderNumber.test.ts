import { describe, it, expect } from "vitest";
import { generatePrefix, formatOrderNumber } from "../orderNumber";

describe("generatePrefix", () => {
  it("extracts consonants from concert name", () => {
    expect(generatePrefix("Summer Festival")).toBe("SMMR");
  });

  it("falls back to alpha chars when too few consonants", () => {
    expect(generatePrefix("AI")).toBe("AI");
  });

  it("returns EVNT for empty string", () => {
    expect(generatePrefix("")).toBe("EVNT");
  });

  it("handles names with all consonants", () => {
    expect(generatePrefix("RHYTHM")).toBe("RHYT");
  });
});

describe("formatOrderNumber", () => {
  it("formats with zero-padded sequence", () => {
    expect(formatOrderNumber("SMMR", 1)).toBe("SMMR-0001");
    expect(formatOrderNumber("SMMR", 42)).toBe("SMMR-0042");
    expect(formatOrderNumber("SMMR", 9999)).toBe("SMMR-9999");
    expect(formatOrderNumber("SMMR", 10000)).toBe("SMMR-10000");
  });
});
