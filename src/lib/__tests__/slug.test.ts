import { describe, it, expect } from "vitest";
import { toSlug } from "../slug";

describe("toSlug", () => {
  it("converts simple name to slug", () => {
    expect(toSlug("Summer Festival")).toBe("summer-festival");
  });

  it("strips diacritics", () => {
    expect(toSlug("Café León")).toBe("cafe-leon");
  });

  it("handles special characters", () => {
    expect(toSlug("Event #1 (VIP)")).toBe("event-1-vip");
  });

  it("handles multiple spaces and hyphens", () => {
    expect(toSlug("  The   Big   Event  ")).toBe("the-big-event");
  });

  it("handles numbers", () => {
    expect(toSlug("Concert 2026")).toBe("concert-2026");
  });

  it("handles all-special input", () => {
    expect(toSlug("!!!")).toBe("");
  });
});
