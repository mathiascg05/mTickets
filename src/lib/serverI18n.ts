import { NextRequest, NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { detectLocale } from "./serverLocale";

type ErrorResponseOptions = {
  values?: Record<string, string | number>;
  extra?: Record<string, unknown>;
};

export async function errorResponse(
  req: NextRequest,
  code: string,
  status: number,
  options?: ErrorResponseOptions,
) {
  const locale = detectLocale(req);
  const t = await getTranslations({ locale, namespace: "apiErrors" });
  const message = t(code, options?.values);
  return NextResponse.json(
    { error: message, code, ...(options?.extra ?? {}) },
    { status },
  );
}
