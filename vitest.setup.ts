import { vi } from "vitest";
import enMessages from "@/messages/en.json";

vi.mock("next-intl/server", () => ({
  getTranslations: async (options?: { namespace?: string }) => {
    const namespace = options?.namespace;
    const nsObj = namespace
      ? namespace.split(".").reduce<unknown>(
          (obj, k) =>
            obj && typeof obj === "object" && k in (obj as Record<string, unknown>)
              ? (obj as Record<string, unknown>)[k]
              : undefined,
          enMessages,
        )
      : enMessages;

    return (key: string, values?: Record<string, string | number>) => {
      const template =
        nsObj && typeof nsObj === "object" && key in (nsObj as Record<string, unknown>)
          ? ((nsObj as Record<string, unknown>)[key] as string)
          : namespace
            ? `${namespace}.${key}`
            : key;
      if (typeof template !== "string") return key;
      if (values) {
        return template.replace(/\{(\w+)\}/g, (_, k) =>
          values[k] != null ? String(values[k]) : `{${k}}`,
        );
      }
      return template;
    };
  },
}));
