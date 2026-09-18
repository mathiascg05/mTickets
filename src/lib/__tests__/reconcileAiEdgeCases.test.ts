import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseAmountText,
  normalizeMemos,
  toBankRow,
  validateExtraction,
} from "@/lib/reconcileAi/movements";
import { matchAllotments, type AllotmentCandidate } from "@/lib/reconcileAi/allotments";
import {
  buildCandidateGroups,
  buildRowCandidates,
  validateSuggestions,
  withinSuggestionTolerance,
  type SuggestOrder,
  type SuggestRow,
} from "@/lib/reconcileAi/suggestions";

const mockGenerate = vi.fn();
vi.mock("@/lib/reconcileAi/gemini", () => ({
  generateJson: (...a: unknown[]) => mockGenerate(...a),
}));
import { extractMovements } from "@/lib/reconcileAi/extract";
import { ReconcileAiError } from "@/lib/reconcileAi/errors";

describe("parseAmountText (monto literal → número, reglas fijas)", () => {
  it.each([
    ["Bs. 98.431,37", 98431.37],
    ["98.431,37", 98431.37],
    ["$1,234.56", 1234.56],
    ["1.000", 1000],
    ["1,000,000.00", 1000000],
    ["1,5", 1.5],
    ["0,50", 0.5],
    ["(45,00)", 45],
    ["-1.000,00", 1000],
    ["+Bs. 1.234.567,89", 1234567.89],
    ["1 234,56", 1234.56],
    ["Bs.S 350,25", 350.25],
  ])("%s → %d", (text, want) => expect(parseAmountText(text)).toBe(want));

  it.each([["abc"], [""], ["Bs."], ["1.2.3,4.5"], [null], [42]])("rechaza %s", (text) =>
    expect(parseAmountText(text)).toBeNull(),
  );
});

describe("validateExtraction con amountText", () => {
  it("el texto literal corrige una conversión errónea del modelo (98.431,37 → 98.43)", () => {
    const r = validateExtraction({
      movements: [{ date: null, description: "X", reference: "1", amountText: "98.431,37", amount: 98.43, direction: "credit" }],
    });
    expect(r.movements[0].amount).toBe(98431.37);
    expect(r.amountsCorrected).toBe(1);
  });

  it("sin amountText usa el número del modelo; montos negativos se vuelven absolutos", () => {
    const r = validateExtraction({
      movements: [{ date: null, description: "X", reference: "1", amountText: null, amount: -50, direction: "debit" }],
    });
    expect(r.movements[0].amount).toBe(50);
    expect(r.amountsCorrected).toBe(0);
  });
});

describe("memo y referencia en el concepto", () => {
  it("normaliza variantes del memo sin tocar códigos inválidos", () => {
    expect(normalizeMemos("de ana mt abcde")).toBe("de ana MT-ABCDE");
    expect(normalizeMemos("MTXYZ23 y MT–QWE45 y mt_abc23")).toBe("MT-XYZ23 y MT-QWE45 y MT-ABC23");
    expect(normalizeMemos("SMTP12345")).toBe("SMTP12345");
    expect(normalizeMemos("MT-AB1CD")).toBe("MT-AB1CD"); // 1 no existe en el alfabeto del memo
  });

  it("Zelle encuentra el memo aunque venga como 'MT ABCDE'", () => {
    const row = toBankRow(
      { index: 0, date: null, description: "Zelle from Ana mt abcde", reference: null, amount: 15, direction: "credit" },
      "zelle",
    );
    expect(row.reference).toContain("MT-ABCDE");
  });

  it("Pago Móvil toma una referencia ETIQUETADA del concepto, nunca dígitos sueltos", () => {
    const m = (description: string) =>
      toBankRow({ index: 0, date: null, description, reference: null, amount: 1, direction: "credit" }, "pago_movil");
    expect(m("PAGO MOVIL 0414 REF 00123456 DE ANA").reference).toBe("00123456");
    expect(m("PAGO MOVIL Ref.: 99887766").reference).toBe("99887766");
    expect(m("PAGO MOVIL 12/09 1.000,00 DE ANA 04141234567").reference).toBe("");
  });
});

describe("lotes: no roban pagos de órdenes", () => {
  const lot: AllotmentCandidate = {
    id: "l1", schoolName: "Colegio", status: "submitted", totalPrice: 10, ticketCount: 1,
    purchaseAmountBs: 1000, proofReferenceNumber: "0098765432", paymentMethodId: "pm-bs",
  };
  const row = { index: 0, amount: 1000, reference: "11112222", description: null };

  it("solo-monto NO etiqueta como lote si una orden calza con ese monto", () => {
    expect(matchAllotments([row], [lot], "pago_movil", { rowHasOrderCandidate: () => true })).toEqual([]);
    expect(matchAllotments([row], [lot], "pago_movil", { rowHasOrderCandidate: () => false })).toHaveLength(1);
  });

  it("solo-monto exige que el colegio haya enviado su pago", () => {
    expect(matchAllotments([row], [{ ...lot, status: "pending" }], "pago_movil")).toEqual([]);
  });

  it("referencia coincidente sí etiqueta aunque haya órdenes del mismo monto", () => {
    const r = matchAllotments([{ ...row, reference: "005432" }], [lot], "pago_movil", { rowHasOrderCandidate: () => true });
    expect(r[0]?.reason).toBe("reference_and_amount");
  });

  it("un lote pagado por otro tipo de método no explica el movimiento", () => {
    expect(
      matchAllotments([{ ...row, reference: "005432" }], [lot], "pago_movil", { methodIdsOfType: new Set(["pm-otro"]) }),
    ).toEqual([]);
  });
});

describe("sugerencias: pagos parciales prohibidos y prioridades", () => {
  it("tolerancia asimétrica: hasta −1% (redondeo) y +5%", () => {
    expect(withinSuggestionTolerance(990, 1000)).toBe(true);
    expect(withinSuggestionTolerance(989.9, 1000)).toBe(false);
    expect(withinSuggestionTolerance(950, 1000)).toBe(false); // parcial
    expect(withinSuggestionTolerance(1050, 1000)).toBe(true);
    expect(withinSuggestionTolerance(1050.1, 1000)).toBe(false);
  });

  const PM = "Pago Móvil";
  const orders: SuggestOrder[] = [
    { id: "a", firstName: "Ana", lastName: "Paz", paymentMethod: PM, proofReferenceNumber: "MT-AAAAA-1234", purchaseAmountBs: 1000, createdAt: 1 },
    { id: "b", firstName: "Beto", lastName: "Ruiz", paymentMethod: PM, proofReferenceNumber: "MT-BBBBB-9876", purchaseAmountBs: 1000, createdAt: 2 },
  ];
  const { groups } = buildCandidateGroups(orders, "pago_movil");

  it("un pago 5% menor no genera candidatas (nunca llega al modelo)", () => {
    const rows: SuggestRow[] = [{ index: 0, date: null, description: null, reference: "555", amount: 950 }];
    expect(buildRowCandidates(rows, groups, "pago_movil")).toEqual([]);
  });

  it("detecta cuando el comprador tecleó los PRIMEROS 4 dígitos", () => {
    const rows: SuggestRow[] = [{ index: 0, date: null, description: null, reference: "12345550099", amount: 1000 }];
    const [w] = buildRowCandidates(rows, groups, "pago_movil");
    const ana = w.candidates.find((c) => c.names.includes("Ana Paz"))!;
    expect(ana.digitsElsewhere).toBe(true);
    expect(w.candidates[0].names).toEqual(["Ana Paz"]); // la señal la prioriza
  });

  it("memo con variante en el concepto cuenta como memo_en_concepto", () => {
    const rows: SuggestRow[] = [{ index: 0, date: null, description: "PAGO mt bbbbb", reference: "1", amount: 1000 }];
    const [w] = buildRowCandidates(rows, groups, "pago_movil");
    expect(w.candidates.find((c) => c.names.includes("Beto Ruiz"))!.memoInConcept).toBe(true);
  });

  it("una 'alta' posterior gana a una 'media' anterior que comparte compra", () => {
    const rows: SuggestRow[] = [
      { index: 0, date: null, description: null, reference: "1", amount: 1000 },
      { index: 1, date: null, description: null, reference: "2", amount: 1000 },
    ];
    const g = groups.find((x) => x.orders[0].id === "a")!.localId;
    const { accepted } = validateSuggestions(
      {
        suggestions: [
          { bankRowIndex: 0, groupIds: [g], confidence: "media", reason: "solo monto" },
          { bankRowIndex: 1, groupIds: [g], confidence: "alta", reason: "monto + nombre" },
        ],
      },
      rows,
      groups,
      "pago_movil",
    );
    expect(accepted).toHaveLength(1);
    expect(accepted[0].rowIndex).toBe(1);
  });
});

describe("extracción por bloques", () => {
  beforeEach(() => {
    mockGenerate.mockReset();
  });
  const csv = (n: number) =>
    ["Fecha;Ref;Monto", ...Array.from({ length: n }, (_, i) => `01/09/2026;${1000 + i};${i + 1},00`)].join("\n");
  const mov = (amount: number) => ({ date: null, description: "x", reference: "1", amountText: null, amount, direction: "credit" });

  it("parte hojas grandes, une los bloques en orden y reindexa", async () => {
    mockGenerate.mockImplementation(async (opts: { parts: { text: string }[] }) => {
      const hasContext = opts.parts[0].text.includes("CONTEXTO");
      return { movements: [mov(hasContext ? 2 : 1)] };
    });
    const r = await extractMovements({ kind: "text", text: csv(400) }, "pago_movil");
    // 401 líneas / 100 por bloque = 5 bloques; solo los siguientes al primero llevan contexto
    expect(r.chunks).toBe(5);
    expect(mockGenerate).toHaveBeenCalledTimes(5);
    expect(r.movements.map((m) => m.amount)).toEqual([1, 2, 2, 2, 2]);
    expect(r.movements.map((m) => m.index)).toEqual([0, 1, 2, 3, 4]);
  });

  it("si un bloque falla, falla todo (nunca resultados a medias)", async () => {
    let call = 0;
    mockGenerate.mockImplementation(async () => {
      call++;
      if (call === 2) throw new ReconcileAiError("AI_TIMEOUT");
      return { movements: [mov(1)] };
    });
    await expect(extractMovements({ kind: "text", text: csv(400) }, "pago_movil")).rejects.toMatchObject({
      code: "AI_TIMEOUT",
    });
  });

  it("una hoja con más filas que el límite se rechaza sin llamar al modelo", async () => {
    await expect(extractMovements({ kind: "text", text: csv(1600) }, "pago_movil")).rejects.toMatchObject({
      code: "TOO_MANY_MOVEMENTS",
    });
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("hojas chicas van en una sola llamada", async () => {
    mockGenerate.mockResolvedValue({ movements: [mov(1)] });
    const r = await extractMovements({ kind: "text", text: csv(50) }, "pago_movil");
    expect(r.chunks).toBe(1);
  });

  it("un PDF que pdf-lib no puede abrir se manda entero (Gemini decide)", async () => {
    mockGenerate.mockRejectedValue(new ReconcileAiError("FILE_UNREADABLE"));
    await expect(
      extractMovements({ kind: "file", mimeType: "application/pdf", data: Buffer.from("%PDF-1.7 basura") }, "pago_movil"),
    ).rejects.toMatchObject({ code: "FILE_UNREADABLE" });
    expect(mockGenerate).toHaveBeenCalledTimes(1);
  });
});

import { crossCheckReads, type Movement } from "@/lib/reconcileAi/movements";
import { ambiguousExactRows } from "@/lib/reconcileAi/imageSafety";
import { runDeterministicMatch, reconcilableGroups, type ReconcileOrder } from "@/lib/reconcile";
import sharp from "sharp";

describe("imágenes: doble lectura", () => {
  const mv = (index: number, amount: number, reference: string, description = "PAGO"): Movement => ({
    index, date: null, description, reference, amount, direction: "credit",
  });

  it("referencia distinta entre lecturas → dudosa (no puede conciliar exacto)", () => {
    const a = [mv(0, 1000, "39134765883"), mv(1, 500, "11112222")];
    const b = [mv(0, 500, "11112222"), mv(1, 1000, "39134765863")]; // otro orden, un dígito distinto
    const r = crossCheckReads(a, b, "pago_movil");
    expect(r.uncertain).toBe(1);
    expect(r.movements[0].uncertainRef).toBe(true);
    expect(r.movements[1].uncertainRef).toBeUndefined();
    expect(toBankRow(r.movements[0], "pago_movil").reference).toBe("");
  });

  it("memo Zelle dudoso se quita del texto que ve el matcher", () => {
    const a = [mv(0, 15, "ZL1", "ZELLE FROM ANA MT-ABCDE")];
    const b = [mv(0, 15, "ZL1", "ZELLE FROM ANA MT-ABCOE")];
    const r = crossCheckReads(a, b, "zelle");
    expect(toBankRow(r.movements[0], "zelle").reference).not.toContain("MT-");
  });

  it("fila que la segunda lectura no vio → dudosa", () => {
    const r = crossCheckReads([mv(0, 1000, "1234")], [], "pago_movil");
    expect(r.movements[0].uncertainRef).toBe(true);
  });

  it("imagen: se leen dos versiones (original + realzada) y se cruzan", async () => {
    mockGenerate.mockReset();
    const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: "#fff" } }).png().toBuffer();
    let call = 0;
    mockGenerate.mockImplementation(async () => {
      call++;
      const ref = call === 1 ? "39134765883" : "39134765863";
      return { movements: [{ date: null, description: "PAGO", reference: ref, amountText: "1.000,00", amount: 1000, direction: "credit" }] };
    });
    const r = await extractMovements({ kind: "file", mimeType: "image/png", data: png }, "pago_movil");
    expect(mockGenerate).toHaveBeenCalledTimes(2);
    expect(r.doubleRead).toBe(true);
    expect(r.uncertainRefs).toBe(1);
  });

  it("PDF de texto: una sola lectura", async () => {
    mockGenerate.mockReset();
    mockGenerate.mockResolvedValue({ movements: [{ date: null, description: "X", reference: "1", amountText: "1,00", amount: 1, direction: "credit" }] });
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    page.drawText("PAGO 1,00", { font: await doc.embedFont(StandardFonts.Helvetica) });
    const r = await extractMovements({ kind: "file", mimeType: "application/pdf", data: Buffer.from(await doc.save()) }, "pago_movil");
    expect(r.doubleRead).toBe(false);
    expect(mockGenerate).toHaveBeenCalledTimes(1);
  });
});

describe("imágenes: vecinos a un dígito", () => {
  const PM = "Pago Móvil";
  const o = (id: string, ref: string, bs: number): ReconcileOrder => ({ id, firstName: id, lastName: "X", paymentMethod: PM, proofReferenceNumber: ref, purchaseAmountBs: bs });

  it("exacto con otra orden del mismo monto a 1 dígito → baja a revisión", () => {
    const pending = [o("real", "MT-AAAAA-5863", 1000), o("vecina", "MT-BBBBB-5883", 1000)];
    const rows = [{ index: 0, reference: "0045883", amount: 1000 }]; // imagen leyó 5883 (real: 5863)
    const det = runDeterministicMatch("pago_movil", rows, pending, [PM]);
    expect(det.matched[0].orderId).toBe("vecina"); // el matcher solo no puede saberlo
    const amb = ambiguousExactRows(det.matched, rows, reconcilableGroups(pending, "pago_movil", [PM]), "pago_movil");
    expect(amb.has(0)).toBe(true);
  });

  it("vecino con OTRO monto no afecta", () => {
    const pending = [o("real", "MT-AAAAA-5863", 2000), o("vecina", "MT-BBBBB-5883", 1000)];
    const rows = [{ index: 0, reference: "0045883", amount: 1000 }];
    const det = runDeterministicMatch("pago_movil", rows, pending, [PM]);
    expect(ambiguousExactRows(det.matched, rows, reconcilableGroups(pending, "pago_movil", [PM]), "pago_movil").size).toBe(0);
  });
});
