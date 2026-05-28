import { withSentryConfig } from "@sentry/nextjs";
import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data: *.instantdb.com",
  "font-src 'self'",
  "connect-src 'self' *.instantdb.com wss://*.instantdb.com ve.dolarapi.com *.sentry.io *.ingest.us.sentry.io",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  eslint: {
    // ESLint is run as its own step (`pnpm lint`). Don't fail production
    // builds on lint findings — there are pre-existing warnings/errors
    // across the codebase that are unrelated to a given deploy.
    ignoreDuringBuilds: true,
  },
  async redirects() {
    return [
      // Spanish-language vanity URLs from before i18n was structured.
      // Permanent redirects to the unified routes (locale prefix "as-needed"
      // means the Spanish URL has no prefix).
      { source: "/terminos", destination: "/terms", permanent: true },
      { source: "/privacidad", destination: "/privacy", permanent: true },
      { source: "/terminos-organizador", destination: "/terms-organizer", permanent: true },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            // camera=(self): el scanner de entradas necesita getUserMedia en
            // nuestro propio origen. camera=() lo bloqueaba para todos los
            // orígenes (incl. self), rompiendo el scanner en Chrome/Android
            // (Safari lo ignoraba, por eso "funcionaba" solo en iPhone).
            value: "camera=(self), microphone=(), geolocation=(), interest-cohort=(), payment=(), usb=()",
          },
          { key: "Content-Security-Policy", value: csp },
        ],
      },
    ];
  },
};

export default withSentryConfig(withNextIntl(nextConfig), {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "matickets",

  project: "matickets",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Uncomment to route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  // tunnelRoute: "/monitoring",

  webpack: {
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,

    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  },
});
