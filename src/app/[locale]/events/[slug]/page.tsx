import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { adminDb } from "@/lib/adminDb";
import { redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { formatEventDate } from "@/lib/formatters";
import type { Lang } from "@/lib/i18n";
import EventDetailClient from "./EventDetailClient";

type Props = {
  params: Promise<{ slug: string; locale: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, locale } = await params;
  const lang = ((routing.locales as readonly string[]).includes(locale) ? locale : routing.defaultLocale) as Lang;
  const t = await getTranslations({ locale: lang, namespace: "seo.event" });

  try {
    const { concerts } = await adminDb.query({
      concerts: { $: { where: { slug } } },
    });
    const concert = concerts[0];
    if (!concert || concert.status !== "active") {
      return { title: t("notFound") };
    }

    const date = formatEventDate(concert.date, lang);
    const description = concert.venue
      ? t("descriptionVenue", { name: concert.name, date, venue: concert.venue })
      : t("description", { name: concert.name, date });

    const title = `${concert.name} ${t("titleSuffix")}`;
    const canonicalPath = lang === routing.defaultLocale ? `/events/${slug}` : `/${lang}/events/${slug}`;

    return {
      title,
      description,
      alternates: {
        canonical: canonicalPath,
        languages: {
          es: `/events/${slug}`,
          en: `/en/events/${slug}`,
        },
      },
      openGraph: {
        title: concert.name,
        description,
        type: "website",
        siteName: "maTickets",
        locale: lang === "es" ? "es_ES" : "en_US",
      },
      twitter: {
        card: "summary_large_image",
        title: concert.name,
        description,
      },
    };
  } catch {
    return { title: t("notFound") };
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
