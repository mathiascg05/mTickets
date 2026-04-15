import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mocks ──

const mockQuery = vi.fn();
const mockCreateToken = vi.fn();
const mockTransact = vi.fn();

const makeTxProxy = () => {
  const chainable: Record<string, unknown> = {};
  chainable.update = () => chainable;
  chainable.link = () => chainable;
  chainable.delete = () => chainable;
  return new Proxy({}, {
    get: () => new Proxy({}, { get: () => () => chainable }),
  });
};

vi.mock("@/lib/adminDb", () => ({
  adminDb: {
    query: (...args: unknown[]) => mockQuery(...args),
    auth: { createToken: (...args: unknown[]) => mockCreateToken(...args) },
    transact: (...args: unknown[]) => mockTransact(...args),
    tx: { $users: makeTxProxy(), credentials: makeTxProxy() },
  },
}));

vi.mock("@instantdb/admin", () => ({
  id: () => "generated-cred-id",
}));

function makeRequest(body: Record<string, unknown>, method = "POST") {
  return new NextRequest("http://localhost/api/admin-auth", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── Tests ──

describe("POST /api/admin-auth", () => {
  let POST: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("@/app/api/admin-auth/route");
    POST = mod.POST;
  });

  it("rejects invalid email with 400", async () => {
    const res = await POST(makeRequest({ email: "not-an-email" }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Invalid email");
  });

  it("login with non-existent account returns 404", async () => {
    mockQuery.mockResolvedValue({ $users: [] });
    const res = await POST(
      makeRequest({ email: "new@example.com", action: "login" }),
    );
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toMatch(/no account found/i);
  });

  it("login with existing account returns ok", async () => {
    mockQuery.mockResolvedValue({
      $users: [{ id: "u1", email: "org@example.com", type: "organizer" }],
    });
    const res = await POST(
      makeRequest({ email: "org@example.com", action: "login" }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  it("register with existing account returns 409", async () => {
    mockQuery.mockResolvedValue({
      $users: [{ id: "u1", email: "existing@example.com", type: "organizer" }],
    });
    const res = await POST(
      makeRequest({ email: "existing@example.com", action: "register" }),
    );
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toMatch(/already exists/i);
  });

  it("register with new email returns ok", async () => {
    mockQuery.mockResolvedValue({ $users: [] });
    const res = await POST(
      makeRequest({ email: "brand-new@example.com", action: "register" }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });
});

describe("PUT /api/admin-auth", () => {
  let PUT: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockCreateToken.mockResolvedValue("mock-token-123");
    mockTransact.mockResolvedValue({});

    const mod = await import("@/app/api/admin-auth/route");
    PUT = mod.PUT;
  });

  it("rejects missing password with 400", async () => {
    const res = await PUT(
      makeRequest({ email: "org@example.com" }, "PUT"),
    );
    expect(res.status).toBe(400);
  });

  it("login with correct password returns token", async () => {
    // bcrypt hash of "TestPass123"
    const { hashPassword } = await import("@/lib/password");
    const hash = await hashPassword("TestPass123");

    mockQuery.mockResolvedValue({
      $users: [{ id: "u1", email: "org@example.com", type: "organizer", credentials: [{ passwordHash: hash }] }],
    });

    const res = await PUT(
      makeRequest({ email: "org@example.com", password: "TestPass123", action: "login" }, "PUT"),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.token).toBe("mock-token-123");
  });

  it("login with wrong password returns 401", async () => {
    const { hashPassword } = await import("@/lib/password");
    const hash = await hashPassword("CorrectPass1");

    mockQuery.mockResolvedValue({
      $users: [{ id: "u1", email: "org@example.com", type: "organizer", credentials: [{ passwordHash: hash }] }],
    });

    const res = await PUT(
      makeRequest({ email: "org@example.com", password: "WrongPass99", action: "login" }, "PUT"),
    );
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toMatch(/incorrect password/i);
  });

  it("login with no password hash returns 400", async () => {
    mockQuery.mockResolvedValue({
      $users: [{ id: "u1", email: "org@example.com", type: "organizer", credentials: [] }],
    });

    const res = await PUT(
      makeRequest({ email: "org@example.com", password: "SomePass123", action: "login" }, "PUT"),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/no password set/i);
  });

  it("register creates account and returns token", async () => {
    mockQuery
      .mockResolvedValueOnce({ $users: [] }) // check user doesn't exist
      .mockResolvedValueOnce({ $users: [{ id: "new-user-1", email: "new@example.com" }] }); // get new user

    const res = await PUT(
      makeRequest({
        email: "new@example.com",
        password: "NewPass123",
        confirmPassword: "NewPass123",
        action: "register",
      }, "PUT"),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.token).toBe("mock-token-123");
    expect(mockCreateToken).toHaveBeenCalledWith({ email: "new@example.com" });
  });

  it("register with mismatched passwords returns 400", async () => {
    const res = await PUT(
      makeRequest({
        email: "new@example.com",
        password: "NewPass123",
        confirmPassword: "DifferentPass",
        action: "register",
      }, "PUT"),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/do not match/i);
  });

  it("register with short password returns 400", async () => {
    const res = await PUT(
      makeRequest({
        email: "new@example.com",
        password: "short",
        confirmPassword: "short",
        action: "register",
      }, "PUT"),
    );
    expect(res.status).toBe(400);
  });
});

describe("authHelpers", () => {
  it("isSuperAdmin returns true for superadmin email", async () => {
    const { isSuperAdmin } = await import("@/lib/authHelpers");
    expect(isSuperAdmin("matickets.ve@gmail.com")).toBe(true);
    expect(isSuperAdmin("MATICKETS.VE@GMAIL.COM")).toBe(true);
  });

  it("isSuperAdmin returns false for other emails", async () => {
    const { isSuperAdmin } = await import("@/lib/authHelpers");
    expect(isSuperAdmin("other@email.com")).toBe(false);
    expect(isSuperAdmin(null)).toBe(false);
    expect(isSuperAdmin(undefined)).toBe(false);
  });

  it("isAuthorizedForConcert: superadmin always authorized", async () => {
    const { isAuthorizedForConcert } = await import("@/lib/authHelpers");
    expect(
      isAuthorizedForConcert("matickets.ve@gmail.com", "anyone@example.com"),
    ).toBe(true);
  });

  it("isAuthorizedForConcert: organizer only for own concerts", async () => {
    const { isAuthorizedForConcert } = await import("@/lib/authHelpers");
    expect(
      isAuthorizedForConcert("org@example.com", "org@example.com"),
    ).toBe(true);
    expect(
      isAuthorizedForConcert("org@example.com", "other@example.com"),
    ).toBe(false);
  });
});
