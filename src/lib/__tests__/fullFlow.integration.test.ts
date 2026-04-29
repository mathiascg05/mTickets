/**
 * Full-flow integration test for the matickets purchase system.
 *
 * Uses a STATEFUL in-memory mock of adminDb so that data persists across
 * sequential API handler calls (join-queue → heartbeat → reservation → order → approve).
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { getAvailability, getTodayString } from "../phases";
import { QUEUE_THRESHOLD, MAX_CONCURRENT } from "../queueConstants";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. Stateful in-memory store
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type Entity = Record<string, unknown> & { id: string };

const store: Record<string, Map<string, Entity>> = {
  concerts: new Map(),
  ticketTypes: new Map(),
  orders: new Map(),
  reservations: new Map(),
  queueEntries: new Map(),
  ticketPhases: new Map(),
  coupons: new Map(),
  paymentMethods: new Map(),
  organizerBalances: new Map(),
  balanceTransactions: new Map(),
  platformFeeConfigs: new Map(),
  emailSuppressions: new Map(),
  $users: new Map(),
  credentials: new Map(),
  messages: new Map(),
  customFields: new Map(),
  exchangeRates: new Map(),
};

// Bidirectional link registry: links[entity][id] = { label: targetId }
const links: Record<string, Map<string, Record<string, string>>> = {};
function ensureLinkMap(entity: string) {
  if (!links[entity]) links[entity] = new Map();
}

// Schema link definitions (from instant.schema.ts)
const LINK_DEFS = [
  { forward: { entity: "ticketTypes", label: "concert" }, reverse: { entity: "concerts", label: "ticketTypes" } },
  { forward: { entity: "orders", label: "ticketType" }, reverse: { entity: "ticketTypes", label: "orders" } },
  { forward: { entity: "paymentMethods", label: "concert" }, reverse: { entity: "concerts", label: "paymentMethods" } },
  { forward: { entity: "customFields", label: "concert" }, reverse: { entity: "concerts", label: "customFields" } },
  { forward: { entity: "ticketPhases", label: "ticketType" }, reverse: { entity: "ticketTypes", label: "phases" } },
  { forward: { entity: "coupons", label: "concert" }, reverse: { entity: "concerts", label: "coupons" } },
  { forward: { entity: "reservations", label: "ticketType" }, reverse: { entity: "ticketTypes", label: "reservations" } },
  { forward: { entity: "queueEntries", label: "ticketType" }, reverse: { entity: "ticketTypes", label: "queueEntries" } },
  { forward: { entity: "messages", label: "concert" }, reverse: { entity: "concerts", label: "messages" } },
  { forward: { entity: "balanceTransactions", label: "organizerBalance" }, reverse: { entity: "organizerBalances", label: "transactions" } },
  { forward: { entity: "platformFeeConfigs", label: "concert" }, reverse: { entity: "concerts", label: "platformFeeConfig" } },
  { forward: { entity: "credentials", label: "user" }, reverse: { entity: "$users", label: "credentials" } },
];

function registerLink(fromEntity: string, fromId: string, label: string, targetId: string) {
  ensureLinkMap(fromEntity);
  const existing = links[fromEntity].get(fromId) || {};
  existing[label] = targetId;
  links[fromEntity].set(fromId, existing);
}

function findLinkDef(fromEntity: string, label: string) {
  // Check forward direction
  for (const def of LINK_DEFS) {
    if (def.forward.entity === fromEntity && def.forward.label === label) {
      return { direction: "forward" as const, def };
    }
    if (def.reverse.entity === fromEntity && def.reverse.label === label) {
      return { direction: "reverse" as const, def };
    }
  }
  return null;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. Query engine
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function matchesWhere(item: Entity, where: Record<string, unknown>): boolean {
  for (const [key, val] of Object.entries(where)) {
    if (key === "and") {
      if (!Array.isArray(val)) return false;
      return val.every((cond: Record<string, unknown>) => matchesWhere(item, cond));
    }
    if (key === "or") {
      if (!Array.isArray(val)) return false;
      return val.some((cond: Record<string, unknown>) => matchesWhere(item, cond));
    }
    if (key === "limit") continue; // handled separately
    // Simple equality
    if (item[key] !== val) return false;
  }
  return true;
}

function resolveRelation(
  fromEntity: string,
  fromId: string,
  relLabel: string,
  relSpec: Record<string, unknown>,
): unknown {
  const linkInfo = findLinkDef(fromEntity, relLabel);
  if (!linkInfo) return [];

  const { direction, def } = linkInfo;

  if (direction === "reverse") {
    // fromEntity is the reverse side; related items are in forward entity
    const fwdEntity = def.forward.entity;
    const fwdLabel = def.forward.label;
    const collection = store[fwdEntity];
    if (!collection) return [];

    let items: Entity[] = [];
    ensureLinkMap(fwdEntity);
    for (const [itemId, itemLinks] of links[fwdEntity].entries()) {
      if (itemLinks[fwdLabel] === fromId) {
        const item = collection.get(itemId);
        if (item) items.push({ ...item });
      }
    }

    // Apply nested where filter
    if (relSpec.$ && (relSpec.$ as Record<string, unknown>).where) {
      const where = (relSpec.$ as Record<string, unknown>).where as Record<string, unknown>;
      items = items.filter((item) => matchesWhere(item, where));
    }

    // Apply ordering
    if (relSpec.$ && (relSpec.$ as Record<string, unknown>).order) {
      const order = (relSpec.$ as Record<string, unknown>).order as Record<string, string>;
      const [field, dir] = Object.entries(order)[0];
      items.sort((a, b) => {
        const av = (a[field] as number) || 0;
        const bv = (b[field] as number) || 0;
        return dir === "desc" ? bv - av : av - bv;
      });
    }

    // Resolve sub-relations
    for (const [subLabel, subSpec] of Object.entries(relSpec)) {
      if (subLabel === "$") continue;
      items = items.map((item) => ({
        ...item,
        [subLabel]: resolveRelation(fwdEntity, item.id, subLabel, subSpec as Record<string, unknown>),
      }));
    }

    return items;
  } else {
    // Forward direction: has-one from the forward entity to the reverse entity
    const revEntity = def.reverse.entity;
    const collection = store[revEntity];
    if (!collection) return [];

    ensureLinkMap(fromEntity);
    const itemLinks = links[fromEntity].get(fromId);
    if (!itemLinks || !itemLinks[relLabel]) return [];
    const targetId = itemLinks[relLabel];
    const target = collection.get(targetId);
    if (!target) return [];

    let item = { ...target };

    // Resolve sub-relations on the target
    for (const [subLabel, subSpec] of Object.entries(relSpec)) {
      if (subLabel === "$") continue;
      (item as Record<string, unknown>)[subLabel] = resolveRelation(
        revEntity,
        item.id,
        subLabel,
        subSpec as Record<string, unknown>,
      );
    }

    // Admin SDK returns has-one as array
    return [item];
  }
}

function mockQuery(queryShape: Record<string, unknown>) {
  const result: Record<string, unknown[]> = {};

  for (const [entityName, spec] of Object.entries(queryShape)) {
    const collection = store[entityName];
    if (!collection) {
      result[entityName] = [];
      continue;
    }

    let items = Array.from(collection.values()).map((e) => ({ ...e }));
    const specObj = spec as Record<string, unknown>;

    // Apply where filters
    if (specObj.$ && (specObj.$ as Record<string, unknown>).where) {
      const where = (specObj.$ as Record<string, unknown>).where as Record<string, unknown>;
      items = items.filter((item) => matchesWhere(item, where));
    }

    // Apply ordering
    if (specObj.$ && (specObj.$ as Record<string, unknown>).order) {
      const order = (specObj.$ as Record<string, unknown>).order as Record<string, string>;
      const [field, dir] = Object.entries(order)[0];
      items.sort((a, b) => {
        const av = (a[field] as number) || 0;
        const bv = (b[field] as number) || 0;
        return dir === "desc" ? bv - av : av - bv;
      });
    }

    // Apply limit
    if (specObj.$ && (specObj.$ as Record<string, unknown>).limit) {
      items = items.slice(0, (specObj.$ as Record<string, unknown>).limit as number);
    }

    // Resolve nested relations
    for (const [relLabel, relSpec] of Object.entries(specObj)) {
      if (relLabel === "$") continue;
      items = items.map((item) => ({
        ...item,
        [relLabel]: resolveRelation(entityName, item.id, relLabel, relSpec as Record<string, unknown>),
      }));
    }

    result[entityName] = items;
  }

  return Promise.resolve(result);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. Transaction engine
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type OpDescriptor = {
  __op: "update" | "delete";
  __entity: string;
  __id: string;
  __data?: Record<string, unknown>;
  __links?: Record<string, string>;
};

function makeTxProxy(): unknown {
  return new Proxy(
    {},
    {
      get: (_target, entity: string) =>
        new Proxy(
          {},
          {
            get: (_t2, id: string) => ({
              update: (data: Record<string, unknown>) => {
                const op: OpDescriptor = {
                  __op: "update",
                  __entity: entity,
                  __id: id,
                  __data: data,
                };
                return {
                  ...op,
                  link: (linkData: Record<string, string>) => ({
                    ...op,
                    __links: linkData,
                  }),
                };
              },
              delete: () => ({
                __op: "delete" as const,
                __entity: entity,
                __id: id,
              }),
            }),
          },
        ),
    },
  );
}

function applyOp(op: OpDescriptor) {
  const collection = store[op.__entity];
  if (!collection) return;

  if (op.__op === "delete") {
    collection.delete(op.__id);
    // Clean up links
    if (links[op.__entity]) {
      links[op.__entity].delete(op.__id);
    }
    // Clean up reverse references
    for (const [entity, linkMap] of Object.entries(links)) {
      for (const [, itemLinks] of linkMap.entries()) {
        for (const [label, targetId] of Object.entries(itemLinks)) {
          if (targetId === op.__id) {
            delete itemLinks[label];
          }
        }
      }
    }
    return;
  }

  // Update/create
  const existing = collection.get(op.__id) || { id: op.__id };
  const updated = { ...existing, ...op.__data };
  collection.set(op.__id, updated);

  // Register links
  if (op.__links) {
    for (const [label, targetId] of Object.entries(op.__links)) {
      registerLink(op.__entity, op.__id, label, targetId);
    }
  }
}

// Hook for Scenario 5.3 rollback test
let transactInterceptor: (() => void) | null = null;

function mockTransact(ops: OpDescriptor | OpDescriptor[]) {
  const opList = Array.isArray(ops) ? ops : [ops];
  for (const op of opList) {
    if (op && op.__op) {
      applyOp(op);
    }
  }
  if (transactInterceptor) {
    transactInterceptor();
    transactInterceptor = null;
  }
  return Promise.resolve();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. Module mocks
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

vi.mock("@/lib/adminDb", () => ({
  adminDb: {
    query: (q: Record<string, unknown>) => mockQuery(q),
    transact: (ops: OpDescriptor | OpDescriptor[]) => mockTransact(ops),
    tx: makeTxProxy(),
    auth: {
      verifyToken: () => Promise.resolve({ email: "organizer@test.com" }),
    },
  },
}));

let idCounter = 0;
function nextId(): string {
  idCounter++;
  const hex = idCounter.toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${hex}`;
}

vi.mock("@instantdb/admin", () => ({
  id: () => nextId(),
}));

vi.mock("@/lib/mailer", () => ({
  transporter: { sendMail: vi.fn().mockResolvedValue(undefined) },
  generateMessageId: () => "mock-msg-id@test.com",
  EMAIL_FROM: "test@matickets.net",
}));

vi.mock("@/lib/emailTemplate", () => ({
  buildConfirmationEmailHtml: () => "<html>confirmation</html>",
  buildConfirmationEmailText: () => "confirmation text",
}));

vi.mock("@/lib/ticketEmailSender", () => ({
  sendTicketEmailForOrder: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/emailHeaders", () => ({
  buildMailHeaders: () => ({}),
}));

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: (fn: () => void) => fn(),
  };
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 5. Seed helpers & constants
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const CONCERT_ID = "c0000000-0000-4000-8000-000000000001";
const TT_ID = "a0000000-0000-4000-8000-000000000001";
const P1_ID = "b0000000-0000-4000-8000-000000000001";
const P2_ID = "b0000000-0000-4000-8000-000000000002";
const P3_ID = "b0000000-0000-4000-8000-000000000003";
const COUPON1_ID = "d0000000-0000-4000-8000-000000000001";
const COUPON2_ID = "d0000000-0000-4000-8000-000000000002";
const COUPON3_ID = "d0000000-0000-4000-8000-000000000003";
const FEE_CONFIG_ID = "e0000000-0000-4000-8000-000000000001";
const BALANCE_ID = "e0000000-0000-4000-8000-000000000002";

function resetStore() {
  for (const map of Object.values(store)) map.clear();
  for (const key of Object.keys(links)) delete links[key];
  idCounter = 0;
  transactInterceptor = null;
}

function seedConcert(overrides: Record<string, unknown> = {}) {
  store.concerts.set(CONCERT_ID, {
    id: CONCERT_ID,
    name: "Rock Fest 2026",
    slug: "rock-fest-2026",
    date: "2026-07-15",
    venue: "Arena Central",
    status: "active",
    organizerEmail: "organizer@test.com",
    lastOrderSeq: 0,
    createdAt: Date.now(),
    ...overrides,
  });
}

function seedTicketType(overrides: Record<string, unknown> = {}) {
  store.ticketTypes.set(TT_ID, {
    id: TT_ID,
    name: "General",
    price: 50,
    quantity: 10,
    lastQueuePosition: 0,
    createdAt: Date.now(),
    ...overrides,
  });
  registerLink("ticketTypes", TT_ID, "concert", CONCERT_ID);
}

function seedPhases() {
  const phases = [
    { id: P1_ID, name: "Early Bird", price: 10, quantity: 2, sortOrder: 1, createdAt: Date.now() },
    { id: P2_ID, name: "Regular", price: 20, quantity: 3, sortOrder: 2, createdAt: Date.now() },
    { id: P3_ID, name: "Last Minute", price: 30, quantity: 5, sortOrder: 3, createdAt: Date.now() },
  ];
  for (const p of phases) {
    store.ticketPhases.set(p.id, p);
    registerLink("ticketPhases", p.id, "ticketType", TT_ID);
  }
}

function seedCoupons() {
  const coupons = [
    { id: COUPON1_ID, code: "SAVE20", discountType: "percentage", discountValue: 20, active: true, createdAt: Date.now() },
    { id: COUPON2_ID, code: "FLAT50", discountType: "fixed", discountValue: 50, active: true, createdAt: Date.now() },
    { id: COUPON3_ID, code: "LIMITED", discountType: "percentage", discountValue: 10, maxUses: 2, active: true, createdAt: Date.now() },
  ];
  for (const c of coupons) {
    store.coupons.set(c.id, c);
    registerLink("coupons", c.id, "concert", CONCERT_ID);
  }
}

function seedFeeConfig(billingMode = "prepaid", balance = 100) {
  store.platformFeeConfigs.set(FEE_CONFIG_ID, {
    id: FEE_CONFIG_ID,
    feePercent: 5,
    feeFixed: 1,
    billingMode,
    updatedAt: Date.now(),
  });
  registerLink("platformFeeConfigs", FEE_CONFIG_ID, "concert", CONCERT_ID);

  store.organizerBalances.set(BALANCE_ID, {
    id: BALANCE_ID,
    email: "organizer@test.com",
    balance,
    currency: "USD",
    updatedAt: Date.now(),
  });
}

function validAttendee(override: Record<string, string> = {}) {
  return {
    firstName: "Juan",
    lastName: "Perez",
    email: "juan@example.com",
    cedula: "12345678",
    ...override,
  };
}

function makeRequest(path: string, body: Record<string, unknown>, headers?: Record<string, string>): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Environment
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

beforeAll(() => {
  process.env.NEXT_PUBLIC_INSTANT_APP_ID = "test-app-id";
  process.env.INSTANT_APP_ADMIN_TOKEN = "test-admin-token";
  process.env.CRON_SECRET = "test-cron-secret";
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
  process.env.GMAIL_USER = "test@gmail.com";
  process.env.NEXT_PUBLIC_ADMIN_EMAIL = "matickets.ve@gmail.com";
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Helper to get store data for assertions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function getOrders(): Entity[] {
  return Array.from(store.orders.values());
}

function getReservations(): Entity[] {
  return Array.from(store.reservations.values());
}

function getQueueEntries(): Entity[] {
  return Array.from(store.queueEntries.values());
}

function getAvail() {
  const tt = store.ticketTypes.get(TT_ID)!;
  const orders = getOrders();
  const phases = Array.from(store.ticketPhases.values()).sort(
    (a, b) => (a.sortOrder as number) - (b.sortOrder as number),
  ) as unknown as { id: string; name: string; price: number; quantity: number; endDate?: string; sortOrder: number }[];
  const reservations = getReservations().filter((r) => (r.expiresAt as number) > Date.now()) as unknown as {
    quantity: number;
    expiresAt: number;
    phaseId?: string;
  }[];
  return getAvailability(
    tt as unknown as { price: number; quantity: number },
    phases,
    orders as unknown as { id: string; status: string; phaseId?: string }[],
    getTodayString(),
    reservations,
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SCENARIO 1: Happy path WITHOUT queue
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("Scenario 1: Happy path without queue", () => {
  let reservationId: string;
  let orderId: string;
  let createReservation: typeof import("@/app/api/create-reservation/route").POST;
  let createOrder: typeof import("@/app/api/create-order/route").POST;

  beforeAll(async () => {
    resetStore();
    seedConcert();
    seedTicketType({ quantity: 10, price: 50 });
    idCounter = 100; // start past seed IDs

    createReservation = (await import("@/app/api/create-reservation/route")).POST;
    createOrder = (await import("@/app/api/create-order/route")).POST;
  });

  it("1.1 availability shows 10 tickets at $50", () => {
    const avail = getAvail();
    expect(avail.available).toBe(10);
    expect(avail.price).toBe(50);
    expect(avail.soldOut).toBe(false);
    expect(avail.activePhase).toBeNull();
  });

  it("1.2 create reservation succeeds", async () => {
    const res = await createReservation(
      makeRequest("/api/create-reservation", { ticketTypeId: TT_ID, qty: 1 }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reservationId).toBeDefined();
    expect(body.expiresAt).toBeGreaterThan(Date.now());
    reservationId = body.reservationId;
    expect(getReservations()).toHaveLength(1);
  });

  it("1.3 availability drops to 9 with active reservation", () => {
    const avail = getAvail();
    expect(avail.available).toBe(9);
  });

  it("1.4 create order with reservation succeeds and deletes reservation", async () => {
    const res = await createOrder(
      makeRequest("/api/create-order", {
        ticketTypeId: TT_ID,
        qty: 1,
        attendees: [validAttendee()],
        paymentMethodName: "Zelle",
        reservationId,
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.orderIds).toHaveLength(1);
    orderId = body.orderIds[0];

    // Reservation should be cleaned up
    expect(getReservations()).toHaveLength(0);
    expect(getOrders()).toHaveLength(1);
  });

  it("1.5 order has correct fields", () => {
    const order = store.orders.get(orderId)!;
    expect(order.status).toBe("pending");
    expect(order.firstName).toBe("Juan");
    expect(order.lastName).toBe("Perez");
    expect(order.email).toBe("juan@example.com");
    expect(order.cedula).toBe("12345678");
    expect(order.paymentMethod).toBe("Zelle");
    expect(order.orderNumber).toMatch(/^RCKF-\d{4}$/);

    const concert = store.concerts.get(CONCERT_ID)!;
    expect(concert.lastOrderSeq).toBe(1);
  });

  it("1.6 approve order (no fee config) changes status to approved", async () => {
    const { approveOrderInternal } = await import("@/lib/approveOrder");
    const result = await approveOrderInternal(orderId, { skipEmail: true });
    expect(result.success).toBe(true);
    expect(result.platformFee).toBe(0);

    const order = store.orders.get(orderId)!;
    expect(order.status).toBe("approved");
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SCENARIO 2: Happy path WITH queue
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("Scenario 2: Happy path with queue", () => {
  let queueEntryId: string;
  let reservationId: string;
  let createReservation: typeof import("@/app/api/create-reservation/route").POST;
  let createOrder: typeof import("@/app/api/create-order/route").POST;
  let joinQueue: typeof import("@/app/api/join-queue/route").POST;
  let heartbeat: typeof import("@/app/api/queue-heartbeat/route").POST;

  beforeAll(async () => {
    resetStore();
    seedConcert();
    seedTicketType({ quantity: 200, price: 30 });
    idCounter = 200;

    // Pre-populate QUEUE_THRESHOLD active reservations to trigger queue
    for (let i = 0; i < QUEUE_THRESHOLD; i++) {
      const rId = `r-prefill-${String(i).padStart(4, "0")}-4000-8000-000000000000`;
      store.reservations.set(rId, {
        id: rId,
        quantity: 1,
        expiresAt: Date.now() + 600_000,
        createdAt: Date.now(),
      });
      registerLink("reservations", rId, "ticketType", TT_ID);
    }

    createReservation = (await import("@/app/api/create-reservation/route")).POST;
    createOrder = (await import("@/app/api/create-order/route")).POST;
    joinQueue = (await import("@/app/api/join-queue/route")).POST;
    heartbeat = (await import("@/app/api/queue-heartbeat/route")).POST;
  });

  it("2.1 reservation without queue token is blocked (403)", async () => {
    const res = await createReservation(
      makeRequest("/api/create-reservation", { ticketTypeId: TT_ID, qty: 1 }),
    );
    expect(res.status).toBe(403);
  });

  it("2.2 join queue returns waiting/admitted status", async () => {
    const res = await joinQueue(
      makeRequest("/api/join-queue", { ticketTypeId: TT_ID, qty: 1, sessionId: "sess-1" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.queueEntryId).toBeDefined();
    expect(body.position).toBe(1);
    queueEntryId = body.queueEntryId;
  });

  it("2.3 heartbeat extends TTL and returns position", async () => {
    const entryBefore = store.queueEntries.get(queueEntryId)!;
    const oldExpiry = entryBefore.expiresAt as number;

    const res = await heartbeat(
      makeRequest("/api/queue-heartbeat", { queueEntryId }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(["waiting", "admitted"]).toContain(body.status);

    const entryAfter = store.queueEntries.get(queueEntryId)!;
    expect(entryAfter.expiresAt as number).toBeGreaterThanOrEqual(oldExpiry);
  });

  it("2.4 free slots → processQueueAdmissions admits user", async () => {
    // Remove 30 reservations to free slots (activeBuyers drops below MAX_CONCURRENT)
    const reservationIds = Array.from(store.reservations.keys());
    for (let i = 0; i < 30; i++) {
      store.reservations.delete(reservationIds[i]);
    }

    const { processQueueAdmissions } = await import("@/lib/queueAdmission");
    await processQueueAdmissions(TT_ID);

    const entry = store.queueEntries.get(queueEntryId)!;
    expect(entry.status).toBe("admitted");
  });

  it("2.5 create reservation with queueToken succeeds", async () => {
    const res = await createReservation(
      makeRequest("/api/create-reservation", {
        ticketTypeId: TT_ID,
        qty: 1,
        queueToken: queueEntryId,
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    reservationId = body.reservationId;

    // Queue entry should be "purchasing"
    const entry = store.queueEntries.get(queueEntryId)!;
    expect(entry.status).toBe("purchasing");
  });

  it("2.6 create order with queueToken completes the queue entry", async () => {
    const res = await createOrder(
      makeRequest("/api/create-order", {
        ticketTypeId: TT_ID,
        qty: 1,
        attendees: [validAttendee()],
        paymentMethodName: "Zelle",
        reservationId,
        queueToken: queueEntryId,
      }),
    );
    expect(res.status).toBe(200);

    const entry = store.queueEntries.get(queueEntryId)!;
    expect(entry.status).toBe("completed");
    expect(getOrders()).toHaveLength(1);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SCENARIO 3: Phase transitions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("Scenario 3: Phase transitions", () => {
  let createReservation: typeof import("@/app/api/create-reservation/route").POST;
  let createOrder: typeof import("@/app/api/create-order/route").POST;

  beforeAll(async () => {
    resetStore();
    seedConcert();
    seedTicketType({ quantity: 10, price: 30 }); // fallback price
    seedPhases(); // P1: 2@$10, P2: 3@$20, P3: 5@$30
    idCounter = 300;

    createReservation = (await import("@/app/api/create-reservation/route")).POST;
    createOrder = (await import("@/app/api/create-order/route")).POST;
  });

  it("3.1 initial availability: Phase 1 at $10, 2 available", () => {
    const avail = getAvail();
    expect(avail.price).toBe(10);
    expect(avail.available).toBe(2);
    expect(avail.activePhase?.id).toBe(P1_ID);
    expect(avail.totalCapacity).toBe(10); // 2+3+5
  });

  it("3.2 buy 2 tickets → Phase 1 full, Phase 2 active", async () => {
    // Reserve
    const rRes = await createReservation(
      makeRequest("/api/create-reservation", { ticketTypeId: TT_ID, qty: 2 }),
    );
    expect(rRes.status).toBe(200);
    const { reservationId } = await rRes.json();

    // Order
    const oRes = await createOrder(
      makeRequest("/api/create-order", {
        ticketTypeId: TT_ID,
        qty: 2,
        attendees: [
          validAttendee(),
          validAttendee({ email: "maria@example.com", firstName: "Maria" }),
        ],
        paymentMethodName: "Zelle",
        reservationId,
      }),
    );
    expect(oRes.status).toBe(200);

    // Both orders should have phaseId = P1
    const orders = getOrders();
    expect(orders).toHaveLength(2);
    for (const o of orders) {
      expect(o.phaseId).toBe(P1_ID);
    }

    // Next availability should be Phase 2
    const avail = getAvail();
    expect(avail.price).toBe(20);
    expect(avail.available).toBe(3);
    expect(avail.activePhase?.id).toBe(P2_ID);
  });

  it("3.3 buy 3 tickets → Phase 2 full, Phase 3 active", async () => {
    const rRes = await createReservation(
      makeRequest("/api/create-reservation", { ticketTypeId: TT_ID, qty: 3 }),
    );
    expect(rRes.status).toBe(200);
    const { reservationId } = await rRes.json();

    const oRes = await createOrder(
      makeRequest("/api/create-order", {
        ticketTypeId: TT_ID,
        qty: 3,
        attendees: [
          validAttendee({ email: "a@test.com", firstName: "A" }),
          validAttendee({ email: "b@test.com", firstName: "B" }),
          validAttendee({ email: "c@test.com", firstName: "C" }),
        ],
        paymentMethodName: "Zelle",
        reservationId,
      }),
    );
    expect(oRes.status).toBe(200);

    const avail = getAvail();
    expect(avail.price).toBe(30);
    expect(avail.available).toBe(5);
    expect(avail.activePhase?.id).toBe(P3_ID);
  });

  it("3.4 buy 5 tickets → all sold out", async () => {
    const rRes = await createReservation(
      makeRequest("/api/create-reservation", { ticketTypeId: TT_ID, qty: 5 }),
    );
    expect(rRes.status).toBe(200);
    const { reservationId } = await rRes.json();

    const oRes = await createOrder(
      makeRequest("/api/create-order", {
        ticketTypeId: TT_ID,
        qty: 5,
        attendees: Array.from({ length: 5 }, (_, i) =>
          validAttendee({ email: `p${i}@test.com`, firstName: `P${i}` }),
        ),
        paymentMethodName: "Zelle",
        reservationId,
      }),
    );
    expect(oRes.status).toBe(200);

    const avail = getAvail();
    expect(avail.soldOut).toBe(true);
    expect(avail.available).toBe(0);
  });

  it("3.5 attempt to reserve more → 409", async () => {
    const res = await createReservation(
      makeRequest("/api/create-reservation", { ticketTypeId: TT_ID, qty: 1 }),
    );
    expect(res.status).toBe(409);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SCENARIO 4: Coupon flow
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("Scenario 4: Coupon flow", () => {
  let createReservation: typeof import("@/app/api/create-reservation/route").POST;
  let createOrder: typeof import("@/app/api/create-order/route").POST;

  beforeAll(async () => {
    resetStore();
    seedConcert();
    seedTicketType({ quantity: 20, price: 100 });
    seedCoupons();
    idCounter = 400;

    createReservation = (await import("@/app/api/create-reservation/route")).POST;
    createOrder = (await import("@/app/api/create-order/route")).POST;
  });

  async function buyWithCoupon(couponCode: string, attendeeOverride: Record<string, string> = {}) {
    const rRes = await createReservation(
      makeRequest("/api/create-reservation", { ticketTypeId: TT_ID, qty: 1 }),
    );
    const { reservationId } = await rRes.json();

    return createOrder(
      makeRequest("/api/create-order", {
        ticketTypeId: TT_ID,
        qty: 1,
        attendees: [validAttendee(attendeeOverride)],
        paymentMethodName: "Zelle",
        reservationId,
        couponCode,
      }),
    );
  }

  it("4.1 percentage coupon (SAVE20) → discount = $20", async () => {
    const res = await buyWithCoupon("SAVE20", { email: "c1@test.com" });
    expect(res.status).toBe(200);
    const { orderIds } = await res.json();
    const order = store.orders.get(orderIds[0])!;
    expect(order.discountAmount).toBe(20); // 20% of $100
    expect(order.couponCode).toBe("SAVE20");
  });

  it("4.2 fixed coupon (FLAT50) → discount = $50", async () => {
    const res = await buyWithCoupon("FLAT50", { email: "c2@test.com" });
    expect(res.status).toBe(200);
    const { orderIds } = await res.json();
    const order = store.orders.get(orderIds[0])!;
    expect(order.discountAmount).toBe(50);
  });

  it("4.3 limited coupon use 1/2 → succeeds", async () => {
    const res = await buyWithCoupon("LIMITED", { email: "c3@test.com" });
    expect(res.status).toBe(200);
  });

  it("4.4 limited coupon use 2/2 → succeeds", async () => {
    const res = await buyWithCoupon("LIMITED", { email: "c4@test.com" });
    expect(res.status).toBe(200);
  });

  it("4.5 limited coupon use 3 → rejected (maxUses=2)", async () => {
    const res = await buyWithCoupon("LIMITED", { email: "c5@test.com" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/usage limit/i);
  });

  it("4.6 case-insensitive matching", async () => {
    const res = await buyWithCoupon("save20", { email: "c6@test.com" });
    expect(res.status).toBe(200);
    const { orderIds } = await res.json();
    const order = store.orders.get(orderIds[0])!;
    expect(order.couponCode).toBe("SAVE20"); // stored as canonical
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SCENARIO 5: Edge cases
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("Scenario 5: Edge cases", () => {
  it("5.1 expired reservation does not reduce availability", () => {
    resetStore();
    seedConcert();
    seedTicketType({ quantity: 5, price: 25 });

    // Add an expired reservation
    store.reservations.set("expired-r", {
      id: "expired-r",
      quantity: 1,
      expiresAt: Date.now() - 10_000,
      createdAt: Date.now() - 60_000,
    });
    registerLink("reservations", "expired-r", "ticketType", TT_ID);

    const avail = getAvail();
    expect(avail.available).toBe(5); // not 4
  });

  it("5.2 rejected/cancelled orders do not count toward sold-out", () => {
    resetStore();
    seedConcert();
    seedTicketType({ quantity: 3, price: 25 });

    const orderData = [
      { id: "o-approved", status: "approved" },
      { id: "o-rejected", status: "rejected" },
      { id: "o-cancelled", status: "cancelled" },
    ];
    for (const o of orderData) {
      store.orders.set(o.id, {
        ...o,
        firstName: "X",
        lastName: "Y",
        email: "x@x.com",
        cedula: "1",
        paymentMethod: "Zelle",
        visited: false,
        createdAt: Date.now(),
      });
      registerLink("orders", o.id, "ticketType", TT_ID);
    }

    const avail = getAvail();
    expect(avail.available).toBe(2); // only approved counts
  });

  it("5.3 post-write rollback detects oversold", async () => {
    resetStore();
    seedConcert();
    seedTicketType({ quantity: 1, price: 25 });
    idCounter = 500;

    // Inject a competing order AFTER the main transact but before post-write re-read
    let firstTransact = true;
    transactInterceptor = null;

    // We'll use a different approach: after the first successful transact,
    // inject an extra order so the post-write availability check sees available < 0
    const origTransact = mockTransact;
    let intercepted = false;

    // Override transact temporarily
    const { adminDb } = await import("@/lib/adminDb");
    const originalTransactFn = adminDb.transact;
    (adminDb as unknown as Record<string, unknown>).transact = async (ops: OpDescriptor | OpDescriptor[]) => {
      await origTransact(ops);
      if (!intercepted) {
        // Check if this was an order creation (look for order entity in ops)
        const opList = Array.isArray(ops) ? ops : [ops];
        const hasOrderCreate = opList.some(
          (op) => op.__entity === "orders" && op.__op === "update",
        );
        if (hasOrderCreate) {
          intercepted = true;
          // Inject competing order
          const competitorId = "competitor-order";
          store.orders.set(competitorId, {
            id: competitorId,
            firstName: "Competitor",
            lastName: "User",
            email: "comp@test.com",
            cedula: "99999",
            paymentMethod: "Zelle",
            status: "pending",
            visited: false,
            createdAt: Date.now(),
          });
          registerLink("orders", competitorId, "ticketType", TT_ID);
        }
      }
    };

    const createOrder = (await import("@/app/api/create-order/route")).POST;
    const res = await createOrder(
      makeRequest("/api/create-order", {
        ticketTypeId: TT_ID,
        qty: 1,
        attendees: [validAttendee()],
        paymentMethodName: "Zelle",
      }),
    );

    // Restore original transact
    (adminDb as unknown as Record<string, unknown>).transact = originalTransactFn;

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("CONCURRENT_CONFLICT");
  });

  it("5.4 expired queue entry → can rejoin with same sessionId", async () => {
    resetStore();
    seedConcert();
    seedTicketType({ quantity: 10, price: 25 });
    idCounter = 600;

    // Add an expired queue entry
    const oldEntryId = "expired-qe-00000-4000-8000-000000000000";
    store.queueEntries.set(oldEntryId, {
      id: oldEntryId,
      sessionId: "sess-expired",
      status: "waiting",
      position: 1,
      quantity: 1,
      expiresAt: Date.now() - 10_000, // expired
      createdAt: Date.now() - 60_000,
    });
    registerLink("queueEntries", oldEntryId, "ticketType", TT_ID);

    const joinQueue = (await import("@/app/api/join-queue/route")).POST;
    const res = await joinQueue(
      makeRequest("/api/join-queue", { ticketTypeId: TT_ID, qty: 1, sessionId: "sess-expired" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // Should get a new entry, not the expired one
    expect(body.queueEntryId).not.toBe(oldEntryId);
  });

  it("5.5 multi-attendee order creates sequential order numbers", async () => {
    resetStore();
    seedConcert();
    seedTicketType({ quantity: 10, price: 25 });
    idCounter = 700;

    const createReservation = (await import("@/app/api/create-reservation/route")).POST;
    const createOrder = (await import("@/app/api/create-order/route")).POST;

    const rRes = await createReservation(
      makeRequest("/api/create-reservation", { ticketTypeId: TT_ID, qty: 3 }),
    );
    expect(rRes.status).toBe(200);
    const { reservationId } = await rRes.json();

    const oRes = await createOrder(
      makeRequest("/api/create-order", {
        ticketTypeId: TT_ID,
        qty: 3,
        attendees: [
          validAttendee({ email: "a@test.com", firstName: "A" }),
          validAttendee({ email: "b@test.com", firstName: "B" }),
          validAttendee({ email: "c@test.com", firstName: "C" }),
        ],
        paymentMethodName: "Zelle",
        reservationId,
      }),
    );
    expect(oRes.status).toBe(200);
    const { orderIds } = await oRes.json();
    expect(orderIds).toHaveLength(3);

    const orderNumbers = orderIds.map((id: string) => store.orders.get(id)!.orderNumber as string);
    expect(orderNumbers[0]).toBe("RCKF-0001");
    expect(orderNumbers[1]).toBe("RCKF-0002");
    expect(orderNumbers[2]).toBe("RCKF-0003");

    const concert = store.concerts.get(CONCERT_ID)!;
    expect(concert.lastOrderSeq).toBe(3);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SCENARIO 6: Approval with platform fees
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("Scenario 6: Approval with platform fees", () => {
  async function createPendingOrder(price = 50): Promise<string> {
    const orderId = `order-fee-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    store.orders.set(orderId, {
      id: orderId,
      firstName: "Test",
      lastName: "User",
      email: "test@fee.com",
      cedula: "11111111",
      paymentMethod: "Zelle",
      status: "pending",
      visited: false,
      createdAt: Date.now(),
      orderNumber: "TEST-0001",
    });
    registerLink("orders", orderId, "ticketType", TT_ID);
    return orderId;
  }

  it("6.1 prepaid: fee deducted and transaction created", async () => {
    resetStore();
    seedConcert();
    seedTicketType({ quantity: 10, price: 50 });
    seedFeeConfig("prepaid", 100);

    const orderId = await createPendingOrder(50);

    const { approveOrderInternal } = await import("@/lib/approveOrder");
    const result = await approveOrderInternal(orderId, { skipEmail: true });

    expect(result.success).toBe(true);
    // fee = 50 * 0.05 + 1 = 3.50
    expect(result.platformFee).toBe(3.5);

    const order = store.orders.get(orderId)!;
    expect(order.status).toBe("approved");

    const balance = store.organizerBalances.get(BALANCE_ID)!;
    expect(balance.balance).toBe(96.5); // 100 - 3.50

    const txns = Array.from(store.balanceTransactions.values());
    expect(txns).toHaveLength(1);
    expect(txns[0].type).toBe("fee");
    expect(txns[0].amount).toBe(-3.5);
    expect(txns[0].balanceBefore).toBe(100);
    expect(txns[0].balanceAfter).toBe(96.5);
  });

  it("6.2 prepaid: insufficient balance fails", async () => {
    resetStore();
    seedConcert();
    seedTicketType({ quantity: 10, price: 50 });
    seedFeeConfig("prepaid", 1); // only $1 balance, fee is $3.50

    const orderId = await createPendingOrder(50);

    const { approveOrderInternal } = await import("@/lib/approveOrder");
    const result = await approveOrderInternal(orderId, { skipEmail: true });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("INSUFFICIENT_BALANCE");

    const order = store.orders.get(orderId)!;
    expect(order.status).toBe("pending"); // unchanged
  });

  it("6.3 postpaid: allows negative balance", async () => {
    resetStore();
    seedConcert();
    seedTicketType({ quantity: 10, price: 50 });
    seedFeeConfig("postpaid", 0); // $0 balance

    const orderId = await createPendingOrder(50);

    const { approveOrderInternal } = await import("@/lib/approveOrder");
    const result = await approveOrderInternal(orderId, { skipEmail: true });

    expect(result.success).toBe(true);
    expect(result.platformFee).toBe(3.5);

    const order = store.orders.get(orderId)!;
    expect(order.status).toBe("approved");

    const balance = store.organizerBalances.get(BALANCE_ID)!;
    expect(balance.balance).toBe(-3.5); // negative is OK for postpaid
  });

  it("6.4 no fee config → simple approve, fee = 0", async () => {
    resetStore();
    seedConcert();
    seedTicketType({ quantity: 10, price: 50 });
    // No seedFeeConfig call → no platformFeeConfig

    const orderId = await createPendingOrder(50);

    const { approveOrderInternal } = await import("@/lib/approveOrder");
    const result = await approveOrderInternal(orderId, { skipEmail: true });

    expect(result.success).toBe(true);
    expect(result.platformFee).toBe(0);

    const order = store.orders.get(orderId)!;
    expect(order.status).toBe("approved");

    // No balance transactions created
    expect(store.balanceTransactions.size).toBe(0);
  });
});
