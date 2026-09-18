import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

const mockApprove = vi.fn(async () => ({ success: true, platformFee: 1 }));

vi.mock("@/lib/adminDb", () => ({
  adminDb: {
    auth: { verifyToken: async () => ({ email: "org@test.com" }) },
    query: async (q: Record<string, unknown>) => {
      if ("concerts" in q) {
        return { concerts: [{ id: "c-1", organizerEmail: "org@test.com", collaborators: [] }] };
      }
      return {
        orders: [
          { id: "mine", ticketType: [{ concert: [{ id: "c-1" }] }] },
          { id: "foreign", ticketType: [{ concert: [{ id: "c-OTHER" }] }] },
        ],
      };
    },
  },
}));
vi.mock("@/lib/approveOrder", () => ({ approveOrderInternal: (...a: unknown[]) => mockApprove(...(a as [])) }));
vi.mock("@/lib/ticketEmailSender", () => ({ sendTicketEmailForOrder: vi.fn() }));
vi.mock("@/lib/auditLog", () => ({ recordAuditLog: vi.fn() }));
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: vi.fn(),
}));

import { POST } from "@/app/api/reconcile-csv/confirm/route";

describe("POST /api/reconcile-csv/confirm", () => {
  it("only approves orders that belong to the authorized concert", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/reconcile-csv/confirm", {
        method: "POST",
        headers: { authorization: "Bearer tok", "content-type": "application/json" },
        body: JSON.stringify({ concertId: "c-1", orderIds: ["mine", "foreign", "ghost"], source: "ai" }),
      }),
    );
    const body = await res.json();
    expect(mockApprove).toHaveBeenCalledTimes(1);
    expect(mockApprove).toHaveBeenCalledWith("mine", { skipEmail: true });
    expect(body.approved).toBe(1);
    expect(body.results.filter((r: { error?: string }) => r.error === "NOT_IN_CONCERT")).toHaveLength(2);
  });
});
