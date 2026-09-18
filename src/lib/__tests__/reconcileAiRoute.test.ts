import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── mocks ────────────────────────────────────────────────────────────────────
const mockQuery = vi.fn();
const mockGenerate = vi.fn();
const mockAudit = vi.fn();

vi.mock("@/lib/adminDb", () => ({
  adminDb: {
    query: (...a: unknown[]) => mockQuery(...a),
    auth: { verifyToken: async () => ({ email: "org@test.com" }) },
  },
}));
vi.mock("@/lib/auditLog", () => ({ recordAuditLog: (...a: unknown[]) => mockAudit(...a) }));
vi.mock("@/lib/reconcileAi/gemini", () => ({
  isGeminiConfigured: () => true,
  generateJson: (...a: unknown[]) => mockGenerate(...a),
}));

import { POST } from "@/app/api/reconcile-ai/route";
import { ReconcileAiError } from "@/lib/reconcileAi/errors";

const CONCERT = "c-1";
const PM = "Pago Móvil";
const ZELLE = "Zelle";

type Fx = { orders: unknown[]; allotments?: unknown[]; runsToday?: number };
function fixtures({ orders, allotments = [], runsToday = 0 }: Fx) {
  mockQuery.mockImplementation(async (q: Record<string, unknown>) => {
    if ("concerts" in q) {
      return {
        concerts: [
          {
            id: CONCERT,
            organizerEmail: "org@test.com",
            collaborators: [],
            paymentMethods: [
              { type: "pago_movil", name: PM },
              { type: "zelle", name: ZELLE },
            ],
          },
        ],
      };
    }
    if ("auditLogs" in q) return { auditLogs: Array.from({ length: runsToday }, (_, i) => ({ id: `l${i}` })) };
    if ("orders" in q) return { orders };
    if ("ticketAllotments" in q) return { ticketAllotments: allotments };
    throw new Error("unexpected query");
  });
}

function request(paymentType: string) {
  const form = new FormData();
  form.set("concertId", CONCERT);
  form.set("paymentType", paymentType);
  form.set("file", new Blob(["%PDF-1.7 fake statement"], { type: "application/pdf" }), "estado.pdf");
  return new NextRequest("http://localhost/api/reconcile-ai", {
    method: "POST",
    headers: { authorization: "Bearer tok" },
    body: form,
  });
}

const credit = (description: string, reference: string | null, amount: number) => ({
  date: "10/09/2026",
  description,
  reference,
  amount,
  direction: "credit",
});

/** Segunda llamada (sugerencias): el "modelo" elige entre las candidatas de cada fila. */
function suggestFromPayload(extra: unknown[] = []) {
  return (opts: { parts: { text: string }[] }) => {
    const payload = JSON.parse(opts.parts[0].text) as {
      movimientos: { i: number; candidatas: { id: string; nombres: string[] }[] }[];
    };
    const pick = (row: number, name: string) =>
      payload.movimientos.find((m) => m.i === row)!.candidatas.find((c) => c.nombres.includes(name))!.id;
    return {
      suggestions: [
        { bankRowIndex: 1, candidateId: pick(1, "Carla Díaz"), confidence: "alta", reason: "Mismo monto y nombre del ordenante" },
        { bankRowIndex: 2, candidateId: pick(2, "Pedro Gil"), confidence: "media", reason: "Mismo monto, referencia con un dígito distinto" },
        ...extra,
      ],
    };
  };
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGenerate.mockReset();
  mockAudit.mockReset();
});

describe("POST /api/reconcile-ai — Pago Móvil statement", () => {
  const orders = [
    // (a) match exacto
    { id: "o-a", orderNumber: "T-A", firstName: "Ana", lastName: "Pérez", paymentMethod: PM, proofReferenceNumber: "MT-AAAAA-1234", purchaseAmountBs: 3650, createdAt: 3 },
    // (c) solo-captura: sin dígitos de referencia
    { id: "o-b", orderNumber: "T-B", firstName: "Carla", lastName: "Díaz", paymentMethod: PM, proofReferenceNumber: "MT-BBBBB-", purchaseAmountBs: 1825, createdAt: 2 },
    // (d) el banco trae la referencia con un dígito cambiado
    { id: "o-c", orderNumber: "T-C", firstName: "Pedro", lastName: "Gil", paymentMethod: PM, proofReferenceNumber: "MT-CCCCC-5678", purchaseAmountBs: 7300, createdAt: 1 },
    // pendiente sin pago en el extracto
    { id: "o-d", orderNumber: "T-D", firstName: "Sin", lastName: "Pago", paymentMethod: PM, proofReferenceNumber: "MT-DDDDD-9999", purchaseAmountBs: 500, createdAt: 4 },
  ];
  const allotments = [
    // (e) lote de colegio
    { id: "lot-1", schoolName: "Colegio San José", status: "submitted", totalPrice: 400, ticketCount: 40, purchaseAmountBs: 146000, proofReferenceNumber: "0098765432" },
  ];
  const statement = {
    movements: [
      credit("PAGO MOVIL RECIBIDO", "009871234", 3650), // 0 exacto
      credit("PAGO MOVIL DE CARLA DIAZ", "55512300", 1825), // 1 sugerencia (sin ref)
      credit("PAGO MOVIL", "11115679", 7300), // 2 sugerencia (dígito cambiado)
      credit("TRANSFERENCIA COLEGIO SAN JOSE", "345432", 146000), // 3 lote
      credit("PAGO MOVIL", "22223333", 999), // 4 ajeno
      { ...credit("COMISION", null, 50), direction: "debit" }, // 5 débito ajeno
    ],
  };

  it("classifies exact, suggestions, allotments and unmatched — and never approves", async () => {
    fixtures({ orders, allotments });
    mockGenerate
      .mockResolvedValueOnce(statement)
      .mockImplementationOnce(
        suggestFromPayload([
          // inventadas por el modelo → deben descartarse
          { bankRowIndex: 2, candidateId: "r1c1", confidence: "alta", reason: "candidata de otra fila" },
          { bankRowIndex: 1, candidateId: "inventada", confidence: "alta", reason: "id inventado" },
        ]),
      );

    const res = await POST(request("pago_movil"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.exactos).toHaveLength(1);
    expect(body.exactos[0].orders.map((o: { orderId: string }) => o.orderId)).toEqual(["o-a"]);

    expect(body.sugerencias.map((s: { rowIndex: number }) => s.rowIndex)).toEqual([1, 2]); // alta primero
    expect(body.sugerencias[0].orders[0].orderId).toBe("o-b");
    expect(body.sugerencias[1].orders[0].orderId).toBe("o-c");
    expect(body.counts.suggestionsDiscarded).toBe(2);

    expect(body.posiblesLotes).toEqual([
      expect.objectContaining({ allotmentId: "lot-1", schoolName: "Colegio San José", reason: "reference_and_amount" }),
    ]);

    expect(body.sinMatch.map((u: { bank: { rowIndex: number } }) => u.bank.rowIndex)).toEqual([4]);
    expect(body.ordenesSinMatch.map((p: { orders: { orderId: string }[] }) => p.orders[0].orderId)).toEqual(["o-d"]);
    expect(body.counts.debitsIgnored).toBe(1);

    // La IA no aprueba: la ruta solo lee y registra la corrida en el audit.
    expect(mockAudit).toHaveBeenCalledTimes(1);
    expect(mockAudit.mock.calls[0][0].action).toBe("reconcile.ai_run");
    expect(JSON.stringify(mockAudit.mock.calls[0][0])).not.toContain("CARLA");

    // Al modelo de sugerencias no le llegan ids reales, emails ni cédulas.
    const sent = mockGenerate.mock.calls[1][0].parts[0].text as string;
    expect(sent).not.toContain("o-b");
    expect(sent).not.toMatch(/@|cedula/i);
    // El lote y el exacto no se ofrecen; la fila 4 (999 Bs) no tiene candidatas
    // dentro de la tolerancia, así que tampoco se envía.
    expect(JSON.parse(sent).movimientos.map((m: { i: number }) => m.i)).toEqual([1, 2]);
  });

  it("still returns exact matches, with a warning, if suggestions fail", async () => {
    fixtures({ orders, allotments });
    mockGenerate.mockResolvedValueOnce(statement).mockRejectedValueOnce(new ReconcileAiError("AI_TIMEOUT"));
    const body = await (await POST(request("pago_movil"))).json();
    expect(body.exactos).toHaveLength(1);
    expect(body.sugerencias).toEqual([]);
    expect(body.warnings).toContain("SUGGESTIONS_UNAVAILABLE");
  });

  it("returns a clear error and nothing else if extraction returns garbage", async () => {
    fixtures({ orders, allotments });
    mockGenerate.mockResolvedValueOnce({ movements: "lol" });
    const res = await POST(request("pago_movil"));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toEqual({ error: "AI_BAD_OUTPUT", code: "AI_BAD_OUTPUT" });
  });

  it("enforces the daily limit per concert before calling Gemini", async () => {
    fixtures({ orders, runsToday: 20 });
    const res = await POST(request("pago_movil"));
    expect(res.status).toBe(429);
    expect(mockGenerate).not.toHaveBeenCalled();
  });
});

describe("POST /api/reconcile-ai — Zelle with extras", () => {
  it("matches the purchase whose totalSnapshot includes extras (the fixed bug)", async () => {
    fixtures({
      orders: [
        {
          id: "z-1",
          orderNumber: "T-Z",
          firstName: "Ana",
          lastName: "Ruiz",
          paymentMethod: ZELLE,
          proofReferenceNumber: "MT-ZXTRA",
          totalSnapshot: 75, // $55 entrada + $20 extras
          ticketType: [{ price: 50, feePercent: 10 }],
          createdAt: 1,
        },
      ],
    });
    mockGenerate.mockResolvedValueOnce({
      movements: [credit("Zelle payment from ANA RUIZ memo mt-zxtra", "ZL123", 75)],
    });
    const body = await (await POST(request("zelle"))).json();
    expect(body.exactos[0].orders[0].orderId).toBe("z-1");
    // Sin huérfanos no hay segunda llamada al modelo.
    expect(mockGenerate).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/reconcile-ai — input validation", () => {
  it("rejects files whose bytes are not PDF/PNG/JPG/WEBP", async () => {
    fixtures({ orders: [] });
    const form = new FormData();
    form.set("concertId", CONCERT);
    form.set("paymentType", "zelle");
    form.set("file", new Blob(["MZ\x90\x00 not a pdf at all"], { type: "application/pdf" }), "x.pdf");
    const res = await POST(
      new NextRequest("http://localhost/api/reconcile-ai", {
        method: "POST",
        headers: { authorization: "Bearer tok" },
        body: form,
      }),
    );
    expect(res.status).toBe(415);
    expect(mockGenerate).not.toHaveBeenCalled();
  });
});
