import { GoogleGenAI, type Part, type Schema } from "@google/genai";
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

/**
 * Una llamada a Gemini con salida JSON forzada por schema. Sin reintentos: un
 * fallo se reporta tal cual para que el organizador use el CSV manual. Nunca
 * loggea el contenido enviado ni recibido.
 */
export async function generateJson(opts: {
  systemInstruction: string;
  parts: Part[];
  schema: Schema;
  timeoutMs: number;
  maxOutputTokens: number;
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
        temperature: 0,
        maxOutputTokens: opts.maxOutputTokens,
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
