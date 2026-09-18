export type ReconcileAiErrorCode =
  | "AI_DISABLED"
  | "AI_TIMEOUT"
  | "AI_UNAVAILABLE"
  | "AI_BAD_OUTPUT"
  | "AI_TRUNCATED"
  | "AI_BLOCKED"
  | "TOO_MANY_MOVEMENTS"
  | "NO_MOVEMENTS"
  | "FILE_UNREADABLE";

export class ReconcileAiError extends Error {
  constructor(public code: ReconcileAiErrorCode) {
    super(code);
    this.name = "ReconcileAiError";
  }
}
