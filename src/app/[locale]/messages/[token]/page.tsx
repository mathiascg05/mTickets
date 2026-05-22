import type { Metadata } from "next";
import MessageThreadClient from "./MessageThreadClient";

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export const dynamic = "force-dynamic";

export default async function MessageThreadPage({
  params,
}: {
  params: Promise<{ token: string; locale: string }>;
}) {
  const { token, locale } = await params;
  return <MessageThreadClient token={token} locale={locale} />;
}
