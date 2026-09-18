import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { isAuthorizedForConcert } from "@/lib/authHelpers";
import { recordAuditLog } from "@/lib/auditLog";
import {
  expectedGroupAmount,
  expectedOrderBs,
  expectedOrderUsd,
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
  MAX_SUGGEST_ROWS,
  type SuggestOrder,
  type ValidatedSuggestion,
} from "@/lib/reconcileAi/suggestions";
import { requestSuggestions } from "@/lib/reconcileAi/suggest";

// Extraccion (~70s) + sugerencias (~35s) + queries.
export const maxDuration = 120;

// Vercel corta el body de una funcion en 4.5 MB: 4 MB de archivo + margen del
// multipart. Las imagenes se reducen en el navegador antes de subir.
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_REQUEST_BYTES = 4.4 * 1024 * 1024;
const MAX_SHEET_CHARS = 1_000_000;
const AUDIT_ACTION = "reconcile.ai_run";
const DAY_MS = 24 * 60 * 60 * 1000;

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
  const user = await adminDb.auth.verifyToken(authToken);
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
    if (!isGeminiConfigured()) return fail("AI_DISABLED", 503);
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
    const { movements, invalid } = await extractMovements(input, type);
    const credits = movements.filter((m) => m.direction === "credit");
    const debitsIgnored = movements.length - credits.length;
    const creditByIndex = new Map(credits.map((m) => [m.index, m]));

    // 2. Matching determinista (mismo modulo que el CSV)
    const pending = (await loadPendingConcertOrders(concertId, type)) as SuggestOrder[];
    const det = runDeterministicMatch(
      type,
      credits.map((m) => toBankRow(m, type)),
      pending,
      methodNames,
    );

    const exactByRow = new Map<number, typeof det.matched>();
    for (const m of det.matched) {
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

    // 3. Lotes (determinista) sobre lo que no cuadro
    let rest = credits.filter((m) => !exactByRow.has(m.index));
    const { ticketAllotments } = await adminDb.query({
      ticketAllotments: { $: { where: { "concert.id": concertId } } },
    });
    const lotMatches = matchAllotments(
      rest,
      ticketAllotments as unknown as AllotmentCandidate[],
      type,
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
    const matchedOrderIds = new Set(det.matched.map((m) => m.orderId));
    const orphanOrders = pending.filter(
      (o) => methodNames.includes(o.paymentMethod) && !matchedOrderIds.has(o.id),
    );
    const warnings: string[] = [];
    let sugerencias: ValidatedSuggestion[] = [];
    let discarded = 0;
    if (rest.length > 0 && orphanOrders.length > 0) {
      const { groups, truncated } = buildCandidateGroups(orphanOrders, type);
      const suggestRows = rest.slice(0, MAX_SUGGEST_ROWS);
      if (truncated || rest.length > MAX_SUGGEST_ROWS) warnings.push("SUGGESTIONS_TRUNCATED");
      // Solo filas con alguna compra dentro de la tolerancia; sin ninguna, no
      // se llama al modelo.
      const withCandidates = buildRowCandidates(suggestRows, groups, type);
      if (withCandidates.length > 0) {
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
      debitsIgnored,
      invalidRows: invalid,
      exactRows: exactos.length,
      exactOrders: det.matched.length,
      suggestions: sugerencias.length,
      suggestionsDiscarded: discarded,
      possibleAllotments: posiblesLotes.length,
      unmatchedRows: sinMatch.length,
      unmatchedPurchases: ordenesSinMatch.length,
    };
    if (invalid > 0) warnings.push("SOME_ROWS_UNREADABLE");
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
      counts,
      warnings,
    });
  } catch (err) {
    if (err instanceof ReconcileAiError) {
      console.error("[reconcile-ai] failed:", err.code, { ms: Date.now() - startedAt });
      const status =
        err.code === "AI_TIMEOUT" ? 504 : err.code === "AI_DISABLED" ? 503 : 502;
      return fail(err.code, err.code === "TOO_MANY_MOVEMENTS" || err.code === "NO_MOVEMENTS" ? 422 : status);
    }
    console.error("[reconcile-ai] Unexpected error:", (err as Error)?.name);
    return fail("Internal server error", 500);
  }
}
