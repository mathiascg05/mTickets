import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { isAuthorizedForConcert } from "@/lib/authHelpers";
import { recordAuditLog } from "@/lib/auditLog";
import {
  expectedGroupAmount,
  expectedOrderBs,
  expectedOrderUsd,
  reconcilableGroups,
  runDeterministicMatch,
  type ReconcilePaymentType,
  type UnmatchedCode,
} from "@/lib/reconcile";
import { loadPendingConcertOrders, methodNamesOfType } from "@/lib/reconcileServer";
import { isGeminiConfigured } from "@/lib/reconcileAi/gemini";
import { ReconcileAiError } from "@/lib/reconcileAi/errors";
import { extractMovements, type ExtractionInput } from "@/lib/reconcileAi/extract";
import { toBankRow, type Movement } from "@/lib/reconcileAi/movements";
import { matchAllotments, type AllotmentCandidate } from "@/lib/reconcileAi/allotments";
import {
  buildCandidateGroups,
  buildRowCandidates,
  groupPurchases,
  resolveCandidateChoices,
  validateSuggestions,
  withinSuggestionTolerance,
  MAX_SUGGEST_ROWS,
  type SuggestOrder,
  type ValidatedSuggestion,
} from "@/lib/reconcileAi/suggestions";
import { requestSuggestions } from "@/lib/reconcileAi/suggest";
import { ambiguousExactRows } from "@/lib/reconcileAi/imageSafety";

// Extraccion (bloques en paralelo, ~60 s para un extracto de 1500 filas) +
// sugerencias (<=35 s) + queries, con margen.
export const maxDuration = 180;
// Si la extraccion se comio el presupuesto, se devuelven exactos y lotes sin
// sugerencias (con aviso) antes que arriesgar el corte de la plataforma.
const SUGGESTIONS_DEADLINE_MS = 130_000;

// Vercel corta el body de una funcion en 4.5 MB: 4 MB de archivo + margen del
// multipart. Las imagenes se reducen en el navegador antes de subir.
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_REQUEST_BYTES = 4.4 * 1024 * 1024;
const MAX_SHEET_CHARS = 1_000_000;
const AUDIT_ACTION = "reconcile.ai_run";
const DAY_MS = 24 * 60 * 60 * 1000;

// Fallos del asistente: 500 con el codigo en el cuerpo. NO 502/503/504:
// Cloudflare (delante de matickets.net) reemplaza esas respuestas por su
// propia pagina "Bad gateway" y el cliente pierde el codigo del error.
const AI_FAILURE_STATUS = 500;

function dailyLimit(): number {
  const n = Number(process.env.RECONCILE_AI_DAILY_LIMIT);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 20;
}

function fail(code: string, status: number) {
  return NextResponse.json({ error: code, code }, { status });
}

/** Tipo real por magic bytes; nunca confiamos en el MIME del cliente. */
function sniffMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (buf[0] === 0x89 && buf.subarray(1, 4).toString("latin1") === "PNG") return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (
    buf.subarray(0, 4).toString("latin1") === "RIFF" &&
    buf.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

async function authorize(req: NextRequest, concertId: string) {
  const authToken = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!authToken) return { ok: false as const, res: fail("Unauthorized", 401) };
  // Un token malformado hace lanzar al SDK: es un 401, no un 500.
  const user = await adminDb.auth.verifyToken(authToken).catch(() => null);
  if (!user?.email) return { ok: false as const, res: fail("Unauthorized", 401) };

  const { concerts } = await adminDb.query({
    concerts: {
      $: { where: { id: concertId } },
      paymentMethods: {},
      collaborators: {},
    },
  });
  const concert = concerts[0];
  if (!concert) return { ok: false as const, res: fail("Concert not found", 404) };
  if (
    !isAuthorizedForConcert(user.email, {
      organizerEmail: concert.organizerEmail,
      collaborators: concert.collaborators,
    })
  ) {
    return { ok: false as const, res: fail("Forbidden", 403) };
  }
  return { ok: true as const, email: user.email, concert };
}

async function runsToday(concertId: string): Promise<number> {
  const { auditLogs } = await adminDb.query({
    auditLogs: {
      $: {
        where: {
          action: AUDIT_ACTION,
          concertId,
          createdAt: { $gt: Date.now() - DAY_MS },
        },
      },
    },
  });
  return auditLogs.length;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const concertId = req.nextUrl.searchParams.get("concertId");
    if (!concertId) return fail("concertId is required", 400);
    const auth = await authorize(req, concertId);
    if (!auth.ok) return auth.res;
    if (!isGeminiConfigured()) {
      return NextResponse.json({ enabled: false });
    }
    const limit = dailyLimit();
    const used = await runsToday(concertId);
    return NextResponse.json({
      enabled: true,
      dailyLimit: limit,
      remainingToday: Math.max(0, limit - used),
    });
  } catch (err) {
    console.error("[reconcile-ai] GET failed:", (err as Error)?.name);
    return fail("Internal server error", 500);
  }
}

type BankInfo = {
  rowIndex: number;
  date: string | null;
  description: string | null;
  reference: string | null;
  amount: number;
};

function bankInfo(m: Movement): BankInfo {
  return {
    rowIndex: m.index,
    date: m.date,
    description: m.description,
    reference: m.reference,
    amount: m.amount,
  };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const startedAt = Date.now();
  try {
    if (!isGeminiConfigured()) return fail("AI_DISABLED", AI_FAILURE_STATUS);
    const contentLength = Number(req.headers.get("content-length") || 0);
    if (contentLength > MAX_REQUEST_BYTES) return fail("FILE_TOO_LARGE", 413);

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return fail("INVALID_INPUT", 400);
    }
    const concertId = form.get("concertId");
    const paymentType = form.get("paymentType");
    const file = form.get("file");
    const sheetText = form.get("sheetText");
    if (typeof concertId !== "string" || !concertId) return fail("INVALID_INPUT", 400);
    if (paymentType !== "pago_movil" && paymentType !== "zelle") {
      return fail("INVALID_INPUT", 400);
    }
    const type: ReconcilePaymentType = paymentType;

    const auth = await authorize(req, concertId);
    if (!auth.ok) return auth.res;
    const methodNames = methodNamesOfType(
      auth.concert.paymentMethods as { type: string; name: string }[] | undefined,
      type,
    );
    if (methodNames.length === 0) return fail("NO_PAYMENT_METHOD", 400);

    // Entrada: archivo nativo (PDF/imagen) o texto de hoja ya parseado en el
    // navegador. El contenido vive solo en memoria durante la request.
    let input: ExtractionInput;
    if (file instanceof File) {
      if (file.size === 0) return fail("INVALID_INPUT", 400);
      if (file.size > MAX_FILE_BYTES) return fail("FILE_TOO_LARGE", 413);
      const data = Buffer.from(await file.arrayBuffer());
      const mimeType = sniffMime(data);
      if (!mimeType) return fail("UNSUPPORTED_FORMAT", 415);
      input = { kind: "file", mimeType, data };
    } else if (typeof sheetText === "string" && sheetText.trim()) {
      if (sheetText.length > MAX_SHEET_CHARS) return fail("FILE_TOO_LARGE", 413);
      input = { kind: "text", text: sheetText };
    } else {
      return fail("INVALID_INPUT", 400);
    }

    const limit = dailyLimit();
    if ((await runsToday(concertId)) >= limit) return fail("RATE_LIMITED", 429);
    // Se registra ANTES de llamar a Gemini: una corrida fallida tambien consume
    // cupo (el costo ya ocurrio). Solo metadatos, nunca contenido.
    await recordAuditLog({
      action: AUDIT_ACTION,
      actorEmail: auth.email,
      entityType: "concert",
      entityId: concertId,
      concertId,
      summary: `Conciliación con archivo del banco (${type === "zelle" ? "Zelle" : "Pago Móvil"})`,
      metadata: {
        paymentType: type,
        input: input.kind === "file" ? input.mimeType : "sheet",
        bytes: input.kind === "file" ? input.data.length : input.text.length,
      },
    });

    // 1. Extraccion
    const { movements, invalid, amountsCorrected, chunks, doubleRead, uncertainRefs } =
      await extractMovements(input, type);
    const credits = movements.filter((m) => m.direction === "credit");
    const debitsIgnored = movements.length - credits.length;
    const creditByIndex = new Map(credits.map((m) => [m.index, m]));

    // 2. Matching determinista (mismo modulo que el CSV)
    const pending = (await loadPendingConcertOrders(concertId, type)) as SuggestOrder[];
    const bankRows = credits.map((m) => toBankRow(m, type));
    const det = runDeterministicMatch(type, bankRows, pending, methodNames);

    // Leido de imagen: un exacto con un "vecino" a un digito del mismo monto
    // no es confiable (un digito mal leido lo explicaria) → revision humana.
    const demoted = doubleRead
      ? ambiguousExactRows(det.matched, bankRows, reconcilableGroups(pending, type, methodNames), type)
      : new Set<number>();
    const exactMatched = det.matched.filter((m) => !demoted.has(m.rowIndex));

    const exactByRow = new Map<number, typeof det.matched>();
    for (const m of exactMatched) {
      if (!exactByRow.has(m.rowIndex)) exactByRow.set(m.rowIndex, []);
      exactByRow.get(m.rowIndex)!.push(m);
    }
    const exactos = Array.from(exactByRow.entries()).map(([rowIndex, matches]) => ({
      bank: bankInfo(creditByIndex.get(rowIndex)!),
      orders: matches.map((m) => ({
        orderId: m.orderId,
        orderNumber: m.orderNumber,
        name: `${m.firstName} ${m.lastName}`.trim(),
        reference: m.orderRef,
        amount: m.orderAmount,
      })),
    }));
    const unmatchedByRow = new Map(det.unmatched.map((u) => [u.rowIndex, u]));
    for (const rowIndex of demoted) {
      unmatchedByRow.set(rowIndex, {
        csvRef: "",
        csvAmount: creditByIndex.get(rowIndex)?.amount ?? 0,
        reason: "Referencia leída de imagen ambigua",
        code: "AMBIGUOUS",
        rowIndex,
      });
    }

    // Ordenes pendientes del metodo sin match, agrupadas por compra. Se
    // calculan ANTES de los lotes: una fila que calza por monto con una orden
    // no se etiqueta como lote solo por monto.
    const matchedOrderIds = new Set(exactMatched.map((m) => m.orderId));
    const orphanOrders = pending.filter(
      (o) => methodNames.includes(o.paymentMethod) && !matchedOrderIds.has(o.id),
    );
    const { groups, truncated } = buildCandidateGroups(orphanOrders, type);
    const rowHasOrderCandidate = (rowIndex: number) => {
      const m = creditByIndex.get(rowIndex);
      return !!m && groups.some((g) => withinSuggestionTolerance(m.amount, g.expected));
    };

    // 3. Lotes (determinista) sobre lo que no cuadro
    let rest = credits.filter((m) => !exactByRow.has(m.index));
    const { ticketAllotments } = await adminDb.query({
      ticketAllotments: { $: { where: { "concert.id": concertId } } },
    });
    const methodIdsOfType = new Set(
      ((auth.concert.paymentMethods || []) as { id: string; type: string }[])
        .filter((pm) => pm.type === type)
        .map((pm) => pm.id),
    );
    const lotMatches = matchAllotments(
      rest,
      ticketAllotments as unknown as AllotmentCandidate[],
      type,
      { methodIdsOfType, rowHasOrderCandidate },
    );
    const posiblesLotes = lotMatches.map((l) => ({
      bank: bankInfo(creditByIndex.get(l.rowIndex)!),
      allotmentId: l.allotmentId,
      schoolName: l.schoolName,
      ticketCount: l.ticketCount,
      expectedAmount: l.expectedAmount,
      reason: l.reason,
    }));
    const lotRows = new Set(lotMatches.map((l) => l.rowIndex));
    rest = rest.filter((m) => !lotRows.has(m.index));

    // 4. Sugerencias (IA) para huerfanos de ambos lados
    const warnings: string[] = [];
    let sugerencias: ValidatedSuggestion[] = [];
    let discarded = 0;
    if (rest.length > 0 && orphanOrders.length > 0) {
      // En Pago Movil la referencia puede venir etiquetada en el concepto.
      const suggestRows = rest.slice(0, MAX_SUGGEST_ROWS).map((m) => ({
        ...m,
        reference: type === "pago_movil" ? toBankRow(m, type).reference || null : m.reference,
      }));
      if (truncated || rest.length > MAX_SUGGEST_ROWS) warnings.push("SUGGESTIONS_TRUNCATED");
      // Solo filas con alguna compra dentro de la tolerancia; sin ninguna, no
      // se llama al modelo.
      const withCandidates = buildRowCandidates(suggestRows, groups, type);
      if (withCandidates.length > 0 && Date.now() - startedAt > SUGGESTIONS_DEADLINE_MS) {
        warnings.push("SUGGESTIONS_UNAVAILABLE");
      } else if (withCandidates.length > 0) {
        try {
          const raw = await requestSuggestions(withCandidates, type);
          const validated = validateSuggestions(
            resolveCandidateChoices(raw, withCandidates),
            suggestRows,
            groups,
            type,
          );
          sugerencias = validated.accepted;
          discarded = validated.discarded;
        } catch (err) {
          const code = err instanceof ReconcileAiError ? err.code : "AI_UNAVAILABLE";
          console.error("[reconcile-ai] suggestions failed:", code);
          warnings.push("SUGGESTIONS_UNAVAILABLE");
        }
      }
    }

    const suggestedRows = new Set(sugerencias.map((s) => s.rowIndex));
    const suggestedOrders = new Set(sugerencias.flatMap((s) => s.orders.map((o) => o.orderId)));
    const sinMatch = rest
      .filter((m) => !suggestedRows.has(m.index))
      .map((m) => {
        const u = unmatchedByRow.get(m.index);
        return {
          bank: bankInfo(m),
          code: (u?.code ?? "NO_MATCH") as UnmatchedCode,
          expectedAmount: u?.expectedAmount ?? null,
        };
      });
    const ordenesSinMatch = groupPurchases(
      orphanOrders.filter((o) => !suggestedOrders.has(o.id)),
    )
      .map((group) => ({
        reference: group[0].proofReferenceNumber ?? null,
        expectedAmount: expectedGroupAmount(group, type),
        createdAt: group[0].createdAt ?? null,
        orders: group.map((o) => ({
          orderId: o.id,
          orderNumber: o.orderNumber || "---",
          name: `${o.firstName} ${o.lastName}`.trim(),
          amount: type === "zelle" ? expectedOrderUsd(o) : expectedOrderBs(o),
        })),
      }))
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

    const counts = {
      movements: movements.length,
      credits: credits.length,
      creditsTotal: Math.round(credits.reduce((sum, m) => sum + m.amount, 0) * 100) / 100,
      debitsIgnored,
      invalidRows: invalid,
      amountsCorrected,
      chunks,
      uncertainRefs,
      demotedFromExact: demoted.size,
      exactRows: exactos.length,
      exactOrders: exactMatched.length,
      suggestions: sugerencias.length,
      suggestionsDiscarded: discarded,
      possibleAllotments: posiblesLotes.length,
      unmatchedRows: sinMatch.length,
      unmatchedPurchases: ordenesSinMatch.length,
    };
    if (invalid > 0) warnings.push("SOME_ROWS_UNREADABLE");
    if (uncertainRefs > 0 || demoted.size > 0) warnings.push("IMAGE_REVIEW");
    console.info("[reconcile-ai] done", { ...counts, ms: Date.now() - startedAt });

    return NextResponse.json({
      paymentType: type,
      currency: type === "zelle" ? "USD" : "BS",
      exactos,
      sugerencias: sugerencias.map((s) => ({
        ...s,
        bank: bankInfo(creditByIndex.get(s.rowIndex)!),
      })),
      posiblesLotes,
      sinMatch,
      ordenesSinMatch,
      // Para cotejar contra el extracto: lo que se ignoro y el total leido.
      debitosIgnorados: movements
        .filter((m) => m.direction === "debit")
        .slice(0, 500)
        .map(bankInfo),
      counts,
      warnings,
    });
  } catch (err) {
    if (err instanceof ReconcileAiError) {
      console.error("[reconcile-ai] failed:", err.code, { ms: Date.now() - startedAt });
      const inputProblem =
        err.code === "TOO_MANY_MOVEMENTS" || err.code === "NO_MOVEMENTS" || err.code === "FILE_UNREADABLE";
      return fail(err.code, inputProblem ? 422 : AI_FAILURE_STATUS);
    }
    console.error("[reconcile-ai] Unexpected error:", (err as Error)?.name);
    return fail("Internal server error", 500);
  }
}
