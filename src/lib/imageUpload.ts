export const ALLOWED_IMAGE_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_TURN = 3;

export type AttachmentMeta = {
  path: string;
  name: string;
  mime: string;
  size: number;
};

export type AttachmentSlot = "customer" | "organizer";

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

const ALLOWED_EXTS = new Set(["jpg", "jpeg", "png", "webp", "heic", "heif"]);

export function isAllowedImageMime(mime: unknown): mime is (typeof ALLOWED_IMAGE_MIME)[number] {
  return typeof mime === "string" && (ALLOWED_IMAGE_MIME as readonly string[]).includes(mime);
}

export function extForMime(mime: string): string {
  return EXT_BY_MIME[mime] ?? "bin";
}

export function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-60);
  return cleaned.length > 0 ? cleaned : "image";
}

export type ImageValidationError = "INVALID_MIME" | "TOO_LARGE" | "TOO_MANY";

export function validateImageFile(file: File): ImageValidationError | null {
  if (!isAllowedImageMime(file.type)) return "INVALID_MIME";
  if (file.size > MAX_IMAGE_BYTES) return "TOO_LARGE";
  return null;
}

export function validateAttachmentCount(count: number): ImageValidationError | null {
  if (count > MAX_ATTACHMENTS_PER_TURN) return "TOO_MANY";
  return null;
}

const ATTACHMENT_BASE = "message-attachments";

export function buildPendingAttachmentPath(uuid: string, mime: string, originalName?: string): string {
  const ext = extForMime(mime);
  const safe = originalName ? sanitizeFilename(originalName) : `image.${ext}`;
  const withExt = safe.endsWith(`.${ext}`) ? safe : `${safe}.${ext}`;
  return `${ATTACHMENT_BASE}/pending/${uuid}/${withExt}`;
}

export function buildOrganizerReplyAttachmentPath(
  messageId: string,
  replyId: string,
  mime: string,
  originalName?: string,
): string {
  const ext = extForMime(mime);
  const safe = originalName ? sanitizeFilename(originalName) : `image.${ext}`;
  const withExt = safe.endsWith(`.${ext}`) ? safe : `${safe}.${ext}`;
  return `${ATTACHMENT_BASE}/${messageId}/organizer/${replyId}/${withExt}`;
}

export function buildCustomerReplyAttachmentPath(
  messageId: string,
  replyId: string,
  mime: string,
  originalName?: string,
): string {
  const ext = extForMime(mime);
  const safe = originalName ? sanitizeFilename(originalName) : `image.${ext}`;
  const withExt = safe.endsWith(`.${ext}`) ? safe : `${safe}.${ext}`;
  return `${ATTACHMENT_BASE}/${messageId}/customer/${replyId}/${withExt}`;
}

const PENDING_PATH_RE =
  /^message-attachments\/pending\/[0-9a-f-]{36}\/[A-Za-z0-9._-]+\.(jpg|jpeg|png|webp|heic|heif)$/;
const ORGANIZER_PATH_RE =
  /^message-attachments\/[0-9a-f-]{36}\/organizer\/[0-9a-f-]{36}\/[A-Za-z0-9._-]+\.(jpg|jpeg|png|webp|heic|heif)$/;
const CUSTOMER_PATH_RE =
  /^message-attachments\/[0-9a-f-]{36}\/customer\/[0-9a-f-]{36}\/[A-Za-z0-9._-]+\.(jpg|jpeg|png|webp|heic|heif)$/;

export function isPendingAttachmentPath(path: unknown): path is string {
  return typeof path === "string" && PENDING_PATH_RE.test(path);
}

export function isOrganizerReplyAttachmentPath(path: unknown, messageId: string): path is string {
  if (typeof path !== "string" || !ORGANIZER_PATH_RE.test(path)) return false;
  return path.startsWith(`message-attachments/${messageId}/organizer/`);
}

export function isCustomerReplyAttachmentPath(path: unknown, messageId: string): path is string {
  if (typeof path !== "string" || !CUSTOMER_PATH_RE.test(path)) return false;
  return path.startsWith(`message-attachments/${messageId}/customer/`);
}

export function parseAttachmentsJson(raw: unknown): AttachmentMeta[] {
  if (typeof raw !== "string" || raw.length === 0) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (it): it is AttachmentMeta =>
          it != null &&
          typeof it.path === "string" &&
          typeof it.name === "string" &&
          typeof it.mime === "string" &&
          typeof it.size === "number",
      )
      .slice(0, MAX_ATTACHMENTS_PER_TURN);
  } catch {
    return [];
  }
}

export function stringifyAttachments(attachments: AttachmentMeta[]): string | null {
  if (attachments.length === 0) return null;
  return JSON.stringify(attachments);
}

export type ServerAttachmentValidation =
  | { ok: true; attachments: AttachmentMeta[] }
  | { ok: false; reason: "INVALID_SHAPE" | "TOO_MANY" | "INVALID_MIME" | "TOO_LARGE" | "BAD_PATH" };

export function shapeCheckAttachments(
  raw: unknown,
  pathValidator: (path: string) => boolean,
): ServerAttachmentValidation {
  if (raw == null) return { ok: true, attachments: [] };
  if (!Array.isArray(raw)) return { ok: false, reason: "INVALID_SHAPE" };
  if (raw.length > MAX_ATTACHMENTS_PER_TURN) return { ok: false, reason: "TOO_MANY" };

  const out: AttachmentMeta[] = [];
  for (const item of raw) {
    if (
      !item ||
      typeof item.path !== "string" ||
      typeof item.name !== "string" ||
      typeof item.mime !== "string" ||
      typeof item.size !== "number"
    ) {
      return { ok: false, reason: "INVALID_SHAPE" };
    }
    if (!isAllowedImageMime(item.mime)) return { ok: false, reason: "INVALID_MIME" };
    if (item.size <= 0 || item.size > MAX_IMAGE_BYTES) return { ok: false, reason: "TOO_LARGE" };
    if (!pathValidator(item.path)) return { ok: false, reason: "BAD_PATH" };

    const ext = item.path.split(".").pop()?.toLowerCase() ?? "";
    if (!ALLOWED_EXTS.has(ext)) return { ok: false, reason: "BAD_PATH" };

    out.push({
      path: item.path,
      name: sanitizeFilename(item.name),
      mime: item.mime,
      size: Math.floor(item.size),
    });
  }
  return { ok: true, attachments: out };
}

type AdminDbLike = {
  query: (q: { $files: { $: { where: { path: { $in: string[] } } } } }) => Promise<{
    $files: Array<{ id: string; path: string; url: string }>;
  }>;
};

export async function verifyAttachmentsExist(
  adminDb: AdminDbLike,
  attachments: AttachmentMeta[],
): Promise<{ ok: true; urls: Record<string, string> } | { ok: false; reason: "MISSING_FILE" }> {
  if (attachments.length === 0) return { ok: true, urls: {} };
  const paths = attachments.map((a) => a.path);
  const { $files } = await adminDb.query({ $files: { $: { where: { path: { $in: paths } } } } });
  if ($files.length !== attachments.length) return { ok: false, reason: "MISSING_FILE" };
  const urls: Record<string, string> = {};
  for (const f of $files) urls[f.path] = f.url;
  for (const a of attachments) if (!urls[a.path]) return { ok: false, reason: "MISSING_FILE" };
  return { ok: true, urls };
}

export type ResolvedAttachment = AttachmentMeta & { url: string };

export function attachWithUrls(
  attachments: AttachmentMeta[],
  urls: Record<string, string>,
): ResolvedAttachment[] {
  return attachments
    .map((a) => (urls[a.path] ? { ...a, url: urls[a.path] } : null))
    .filter((a): a is ResolvedAttachment => a !== null);
}
