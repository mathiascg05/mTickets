import { describe, it, expect } from "vitest";
import {
  buildCustomerReplyAttachmentPath,
  buildOrganizerReplyAttachmentPath,
  buildPendingAttachmentPath,
  isCustomerReplyAttachmentPath,
  isOrganizerReplyAttachmentPath,
  isPendingAttachmentPath,
  parseAttachmentsJson,
  sanitizeFilename,
  shapeCheckAttachments,
  stringifyAttachments,
  validateImageFile,
} from "../imageUpload";

const MESSAGE_ID = "01234567-89ab-cdef-0123-456789abcdef";
const REPLY_ID = "fedcba98-7654-3210-fedc-ba9876543210";

function makeFile(name: string, type: string, size: number): File {
  const blob = new Blob([new Uint8Array(size)], { type });
  return new File([blob], name, { type });
}

describe("validateImageFile", () => {
  it("accepts a 1MB jpeg", () => {
    const f = makeFile("photo.jpg", "image/jpeg", 1024 * 1024);
    expect(validateImageFile(f)).toBeNull();
  });

  it("rejects a 6MB jpeg", () => {
    const f = makeFile("photo.jpg", "image/jpeg", 6 * 1024 * 1024);
    expect(validateImageFile(f)).toBe("TOO_LARGE");
  });

  it("rejects a pdf", () => {
    const f = makeFile("doc.pdf", "application/pdf", 1024);
    expect(validateImageFile(f)).toBe("INVALID_MIME");
  });

  it("accepts HEIC", () => {
    const f = makeFile("photo.heic", "image/heic", 2 * 1024 * 1024);
    expect(validateImageFile(f)).toBeNull();
  });
});

describe("path helpers", () => {
  it("builds + validates pending paths", () => {
    const path = buildPendingAttachmentPath(MESSAGE_ID, "image/png", "Cool Photo!.png");
    expect(isPendingAttachmentPath(path)).toBe(true);
    expect(path).toMatch(/^message-attachments\/pending\/[0-9a-f-]{36}\/[A-Za-z0-9._-]+\.png$/);
  });

  it("rejects pending path with wrong extension", () => {
    expect(isPendingAttachmentPath(`message-attachments/pending/${MESSAGE_ID}/file.gif`)).toBe(
      false,
    );
  });

  it("builds + validates organizer paths bound to a message id", () => {
    const path = buildOrganizerReplyAttachmentPath(MESSAGE_ID, REPLY_ID, "image/jpeg", "x.jpg");
    expect(isOrganizerReplyAttachmentPath(path, MESSAGE_ID)).toBe(true);
    expect(isOrganizerReplyAttachmentPath(path, REPLY_ID)).toBe(false);
  });

  it("rejects organizer path under customer/", () => {
    const path = buildCustomerReplyAttachmentPath(MESSAGE_ID, REPLY_ID, "image/jpeg", "x.jpg");
    expect(isOrganizerReplyAttachmentPath(path, MESSAGE_ID)).toBe(false);
    expect(isCustomerReplyAttachmentPath(path, MESSAGE_ID)).toBe(true);
  });

  it("path traversal is sanitized in filename", () => {
    const path = buildPendingAttachmentPath(MESSAGE_ID, "image/png", "../../etc/passwd.png");
    expect(path).not.toContain("../");
    expect(isPendingAttachmentPath(path)).toBe(true);
  });
});

describe("sanitizeFilename", () => {
  it("strips disallowed chars", () => {
    expect(sanitizeFilename("../foo/bar baz.png")).not.toContain("/");
    expect(sanitizeFilename("../foo/bar baz.png")).not.toContain(" ");
  });

  it("collapses long names", () => {
    const long = "a".repeat(200) + ".png";
    expect(sanitizeFilename(long).length).toBeLessThanOrEqual(60);
  });
});

describe("shapeCheckAttachments", () => {
  const okPath = `message-attachments/pending/${MESSAGE_ID}/x.png`;

  it("returns ok for null/missing", () => {
    expect(shapeCheckAttachments(undefined, isPendingAttachmentPath)).toEqual({
      ok: true,
      attachments: [],
    });
  });

  it("rejects too many", () => {
    const arr = Array.from({ length: 4 }, () => ({
      path: okPath,
      name: "x.png",
      mime: "image/png",
      size: 100,
    }));
    expect(shapeCheckAttachments(arr, isPendingAttachmentPath)).toEqual({
      ok: false,
      reason: "TOO_MANY",
    });
  });

  it("rejects invalid mime", () => {
    expect(
      shapeCheckAttachments(
        [{ path: okPath, name: "x.png", mime: "application/zip", size: 100 }],
        isPendingAttachmentPath,
      ),
    ).toEqual({ ok: false, reason: "INVALID_MIME" });
  });

  it("rejects too-large file", () => {
    expect(
      shapeCheckAttachments(
        [{ path: okPath, name: "x.png", mime: "image/png", size: 50 * 1024 * 1024 }],
        isPendingAttachmentPath,
      ),
    ).toEqual({ ok: false, reason: "TOO_LARGE" });
  });

  it("rejects cross-prefix path", () => {
    expect(
      shapeCheckAttachments(
        [
          {
            path: `message-attachments/${MESSAGE_ID}/customer/r/x.png`,
            name: "x.png",
            mime: "image/png",
            size: 100,
          },
        ],
        isPendingAttachmentPath,
      ),
    ).toEqual({ ok: false, reason: "BAD_PATH" });
  });

  it("accepts a valid attachment", () => {
    const res = shapeCheckAttachments(
      [{ path: okPath, name: "Pretty Photo.png", mime: "image/png", size: 100 }],
      isPendingAttachmentPath,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.attachments[0]?.name).not.toContain(" ");
    }
  });
});

describe("parseAttachmentsJson / stringifyAttachments", () => {
  it("round-trips", () => {
    const items = [
      { path: "message-attachments/x/y.png", name: "y.png", mime: "image/png", size: 10 },
    ];
    const s = stringifyAttachments(items);
    expect(s).not.toBeNull();
    expect(parseAttachmentsJson(s)).toEqual(items);
  });

  it("returns [] for garbage", () => {
    expect(parseAttachmentsJson("not json")).toEqual([]);
    expect(parseAttachmentsJson(undefined)).toEqual([]);
    expect(parseAttachmentsJson("[1,2,3]")).toEqual([]);
  });

  it("caps at MAX", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      path: `message-attachments/x/${i}.png`,
      name: `${i}.png`,
      mime: "image/png",
      size: 10,
    }));
    const s = stringifyAttachments(items)!;
    expect(parseAttachmentsJson(s).length).toBeLessThanOrEqual(3);
  });
});
