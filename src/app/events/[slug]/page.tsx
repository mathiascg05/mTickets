import type { Metadata } from "next";
import { adminDb } from "@/lib/adminDb";
import EventDetailClient from "./EventDetailClient";

type Props = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;

  try {
    const { concerts } = await adminDb.query({
      concerts: { $: { where: { slug } } },
    });
    const concert = concerts[0];
    if (!concert) {
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

export default function ConcertDetailPage() {
  return <EventDetailClient />;
}
