import { describe, it, expect } from "vitest";
import { scrubSentryEvent } from "../sentryScrub";

describe("scrubSentryEvent", () => {
  it("scrubs sensitive fields in request.data", () => {
    const event = {
      request: {
        data: {
          email: "user@example.com",
          password: "hunter2",
          confirmPassword: "hunter2",
          token: "abc",
          cedula: "V-12345678",
          pin: "1234",
        },
      },
    };
    const out = scrubSentryEvent(event);
    expect(out.request.data).toEqual({
      email: "user@example.com",
      password: "[SCRUBBED]",
      confirmPassword: "[SCRUBBED]",
      token: "[SCRUBBED]",
      cedula: "[SCRUBBED]",
      pin: "[SCRUBBED]",
    });
  });

  it("scrubs nested sensitive fields recursively", () => {
    const event = {
      request: {
        data: {
          attendees: [
            { firstName: "Ana", cedula: "V-1" },
            { firstName: "Luis", cedula: "V-2" },
          ],
          referenceNumber: "REF-123",
        },
      },
    };
    const out = scrubSentryEvent(event);
    expect(out.request.data).toEqual({
      attendees: [
        { firstName: "Ana", cedula: "[SCRUBBED]" },
        { firstName: "Luis", cedula: "[SCRUBBED]" },
      ],
      referenceNumber: "[SCRUBBED]",
    });
  });

  it("scrubs scannerPin and pmCedula via pattern match", () => {
    const event = {
      extra: {
        scannerPin: "9999",
        pmCedula: "V-1",
        regularField: "ok",
      },
    };
    const out = scrubSentryEvent(event);
    expect(out.extra).toEqual({
      scannerPin: "[SCRUBBED]",
      pmCedula: "[SCRUBBED]",
      regularField: "ok",
    });
  });

  it("scrubs cookies entirely", () => {
    const event = {
      request: { cookies: { session: "abc", csrf: "xyz" } },
    };
    const out = scrubSentryEvent(event);
    expect(out.request.cookies).toBe("[SCRUBBED]");
  });

  it("scrubs breadcrumb data", () => {
    const event = {
      breadcrumbs: [
        { message: "POST /api/x", data: { password: "p", email: "e@x.com" } },
      ],
    };
    const out = scrubSentryEvent(event);
    expect(out.breadcrumbs?.[0].data).toEqual({
      password: "[SCRUBBED]",
      email: "e@x.com",
    });
  });

  it("does not match pin substring inside other words", () => {
    const event = {
      request: { data: { shipping: "express", spinning: true } },
    };
    const out = scrubSentryEvent(event);
    expect(out.request.data).toEqual({ shipping: "express", spinning: true });
  });

  it("returns event unchanged when no sensitive data present", () => {
    const event = { request: { data: { foo: "bar" } } };
    const out = scrubSentryEvent(event);
    expect(out.request.data).toEqual({ foo: "bar" });
  });

  it("handles missing fields gracefully", () => {
    const event = {};
    expect(() => scrubSentryEvent(event)).not.toThrow();
  });

  it("respects depth limit for circular-like structures", () => {
    const deep: Record<string, unknown> = { password: "secret" };
    let current = deep;
    for (let i = 0; i < 15; i++) {
      const next: Record<string, unknown> = { password: "secret" };
      current.next = next;
      current = next;
    }
    const event = { extra: deep };
    expect(() => scrubSentryEvent(event)).not.toThrow();
  });
});
