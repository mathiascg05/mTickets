import type { Metadata } from "next";
import { cookies } from "next/headers";
import { adminDb } from "@/lib/adminDb";
import { redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import EventDetailClient from "./EventDetailClient";

type Props = {
  params: Promise<{ slug: string; locale: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;

  try {
    const { concerts } = await adminDb.query({
      concerts: { $: { where: { slug } } },
    });
    const concert = concerts[0];
    if (!concert || concert.status !== "active") {
      return { title: "Event Not Found | maTickets" };
    }

    const date = new Date(concert.date).toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    });
    const description = concert.venue
      ? `${date} at ${concert.venue}`
      : date;

    return {
      title: `${concert.name} | maTickets`,
      description: `Get tickets for ${concert.name}. ${description}`,
      openGraph: {
        title: concert.name,
        description: `Get tickets for ${concert.name}. ${description}`,
        type: "website",
        siteName: "maTickets",
      },
      twitter: {
        card: "summary_large_image",
        title: concert.name,
        description: `Get tickets for ${concert.name}. ${description}`,
      },
    };
  } catch {
    return { title: "maTickets - Event Ticketing" };
  }
}

export default async function ConcertDetailPage({ params }: Props) {
  const { slug, locale } = await params;

  const cookieStore = await cookies();
  const hasLocaleCookie = cookieStore.has("NEXT_LOCALE");

  if (!hasLocaleCookie) {
    try {
      const { concerts } = await adminDb.query({
        concerts: { $: { where: { slug } } },
      });
      const concert = concerts[0];
      const defaultLang = (concert as { defaultLanguage?: string } | undefined)?.defaultLanguage;
      if (
        defaultLang &&
        (routing.locales as readonly string[]).includes(defaultLang) &&
        defaultLang !== locale
      ) {
        redirect({ href: `/events/${slug}`, locale: defaultLang });
      }
    } catch {
      // best effort; fall through to render
    }
  }

  return <EventDetailClient />;
}
