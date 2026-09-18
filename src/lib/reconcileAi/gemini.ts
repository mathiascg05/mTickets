import { GoogleGenAI, MediaResolution, type Part, type Schema } from "@google/genai";
import { ReconcileAiError } from "./errors";

// Tier economico vigente de la linea Flash (ai.google.dev/gemini-api/docs/models,
// verificado 2026-09-18). Sobrescribible con GEMINI_MODEL.
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

export function isGeminiConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new ReconcileAiError("AI_DISABLED");
  if (!client) client = new GoogleGenAI({ apiKey });
  return client;
}

const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [1_500, 4_000];

/**
 * Una llamada a Gemini con salida JSON forzada por schema. Solo reintenta ante
 * saturacion o fallo transitorio (429/5xx), con espera creciente; cualquier
 * otro fallo se reporta tal cual para que el organizador use el CSV manual.
 * Nunca loggea el contenido enviado ni recibido.
 */
export async function generateJson(opts: Parameters<typeof generateJsonOnce>[0] & { retries?: number }): Promise<unknown> {
  const retries = Math.min(opts.retries ?? 0, RETRY_DELAYS_MS.length);
  for (let attempt = 0; ; attempt++) {
    try {
      return await generateJsonOnce(opts);
    } catch (err) {
      const transient = err instanceof TransientGeminiError;
      if (!transient || attempt >= retries) {
        throw transient ? new ReconcileAiError("AI_UNAVAILABLE") : err;
      }
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    }
  }
}

class TransientGeminiError extends Error {}

async function generateJsonOnce(opts: {
  systemInstruction: string;
  parts: Part[];
  schema: Schema;
  timeoutMs: number;
  maxOutputTokens: number;
  /** La entrada lleva un archivo (PDF/imagen): lectura en alta resolucion y un
   * 400 de la API significa que el archivo no se pudo procesar. */
  hasFile?: boolean;
  temperature?: number;
}): Promise<unknown> {
  const ai = getClient();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  let text: string | undefined;
  try {
    const res = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
      contents: [{ role: "user", parts: opts.parts }],
      config: {
        systemInstruction: opts.systemInstruction,
        responseMimeType: "application/json",
        responseSchema: opts.schema,
        temperature: opts.temperature ?? 0,
        maxOutputTokens: opts.maxOutputTokens,
        ...(opts.hasFile ? { mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH } : {}),
        abortSignal: controller.signal,
        httpOptions: { timeout: opts.timeoutMs, retryOptions: { attempts: 1 } },
      },
    });
    const candidate = res.candidates?.[0];
    const finish = candidate?.finishReason;
    if (res.promptFeedback?.blockReason || finish === "SAFETY" || finish === "PROHIBITED_CONTENT") {
      throw new ReconcileAiError("AI_BLOCKED");
    }
    if (finish === "MAX_TOKENS") throw new ReconcileAiError("AI_TRUNCATED");
    text = res.text;
  } catch (err) {
    if (err instanceof ReconcileAiError) throw err;
    if (controller.signal.aborted) throw new ReconcileAiError("AI_TIMEOUT");
    // Solo el tipo/estado del error, nunca el payload.
    const status = (err as { status?: number })?.status;
    console.error("[reconcile-ai] Gemini call failed", {
      status,
      name: (err as Error)?.name,
    });
    // Key invalida tambien llega como 400: es un problema de configuracion
    // del servidor, no del archivo del organizador.
    if (status === 400 && /API_KEY_INVALID|API key not valid/i.test(String((err as Error)?.message))) {
      console.error("[reconcile-ai] GEMINI_API_KEY invalida o revocada");
      throw new ReconcileAiError("AI_UNAVAILABLE");
    }
    // PDF corrupto, protegido o imagen ilegible: la API lo rechaza con 400.
    if (opts.hasFile && status === 400) throw new ReconcileAiError("FILE_UNREADABLE");
    if (status != null && TRANSIENT_STATUS.has(status)) throw new TransientGeminiError();
    throw new ReconcileAiError("AI_UNAVAILABLE");
  } finally {
    clearTimeout(timer);
  }
  if (!text) throw new ReconcileAiError("AI_BAD_OUTPUT");
  try {
    return JSON.parse(text);
  } catch {
    throw new ReconcileAiError("AI_BAD_OUTPUT");
  }
}
