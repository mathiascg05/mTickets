const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /api[_-]?key/i,
  /authorization/i,
  /cookie/i,
  /cedula/i,
  /reference[_-]?number/i,
  /^pin$/i,
  /scannerpin/i,
];

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((p) => p.test(key));
}

function scrubObject(obj: unknown, depth = 0): unknown {
  if (depth > 10 || obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map((item) => scrubObject(item, depth + 1));

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    result[key] = isSensitiveKey(key) ? "[SCRUBBED]" : scrubObject(value, depth + 1);
  }
  return result;
}

type SentryEventLike = {
  request?: { data?: unknown; cookies?: unknown; headers?: unknown };
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  breadcrumbs?: Array<{ data?: unknown; message?: string }>;
};

export function scrubSentryEvent<T extends SentryEventLike>(event: T): T {
  if (event.request?.data) {
    event.request.data = scrubObject(event.request.data);
  }
  if (event.request?.cookies) {
    event.request.cookies = "[SCRUBBED]";
  }
  if (event.extra) {
    event.extra = scrubObject(event.extra) as Record<string, unknown>;
  }
  if (event.contexts) {
    event.contexts = scrubObject(event.contexts) as Record<string, unknown>;
  }
  if (Array.isArray(event.breadcrumbs)) {
    event.breadcrumbs = event.breadcrumbs.map((b) => ({
      ...b,
      data: b.data ? scrubObject(b.data) : b.data,
    }));
  }
  return event;
}
