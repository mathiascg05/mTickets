import { describe, it, expect } from "vitest";
import { generatePrefix, formatOrderNumber, pickUniquePrefix } from "../orderNumber";

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

describe("pickUniquePrefix", () => {
  it("returns the base prefix when nothing collides", () => {
    expect(pickUniquePrefix("Summer Festival", new Set())).toBe("SMMR");
  });

  it("mutates the last char to a digit on first collision", () => {
    expect(pickUniquePrefix("Summer Festival", new Set(["SMMR"]))).toBe("SMM2");
  });

  it("walks through digits when multiple collisions exist", () => {
    expect(
      pickUniquePrefix(
        "Summer Festival",
        new Set(["SMMR", "SMM2", "SMM3"]),
      ),
    ).toBe("SMM4");
  });

  it("falls back to non-vowel letters after digits are exhausted", () => {
    const taken = new Set([
      "SMMR",
      "SMM2", "SMM3", "SMM4", "SMM5", "SMM6", "SMM7", "SMM8", "SMM9",
    ]);
    expect(pickUniquePrefix("Summer Festival", taken)).toBe("SMMZ");
  });

  it("resolves the real Andes/Merici case so they get distinct prefixes", () => {
    const andes = "After 4to vs 5to Andes";
    const merici = "AFTER 4TOVS5TO MERICI";
    expect(generatePrefix(andes)).toBe("FTRT");
    expect(generatePrefix(merici)).toBe("FTRT");

    const taken = new Set<string>();
    const andesPrefix = pickUniquePrefix(andes, taken);
    taken.add(andesPrefix);
    const mericiPrefix = pickUniquePrefix(merici, taken);

    expect(andesPrefix).toBe("FTRT");
    expect(mericiPrefix).toBe("FTR2");
    expect(andesPrefix).not.toBe(mericiPrefix);
  });
});
