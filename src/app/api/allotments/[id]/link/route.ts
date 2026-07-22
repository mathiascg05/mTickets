import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/adminDb";
import { isAuthorizedForConcert } from "@/lib/authHelpers";
import { resolveEmailLang } from "@/lib/serverLocale";

function firstOf<T>(raw: unknown): T | undefined {
  return (Array.isArray(raw) ? raw[0] : raw) as T | undefined;
}

// Returns the school's management URL to an authorized organizer so they can
// copy/share it themselves. The manageToken is field-restricted from client
// queries, so it's resolved here with the Admin SDK.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authToken = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!authToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await adminDb.auth.verifyToken(authToken);
  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { ticketAllotments } = await adminDb.query({
    ticketAllotments: {
      $: { where: { id } },
      concert: { collaborators: {} },
    },
  });
  const allotment = ticketAllotments[0];
  if (!allotment) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const concert = firstOf<{
    organizerEmail: string;
    defaultLanguage?: string;
    collaborators?: { email: string }[];
  }>(allotment.concert);
  if (!concert || !isAuthorizedForConcert(user.email, concert)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!allotment.manageToken) {
    return NextResponse.json({ error: "TOKEN_REVOKED" }, { status: 410 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const lang = resolveEmailLang(
    allotment.language as string | undefined,
    concert.defaultLanguage,
  );
  const url = `${appUrl}/${lang}/allotment/${allotment.manageToken}`;
  return NextResponse.json({ url });
}
