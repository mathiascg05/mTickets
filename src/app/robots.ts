import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://matickets.com";
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/admin", "/ticket/", "/buy/", "/queue/", "/scan"],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
