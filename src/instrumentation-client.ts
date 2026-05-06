// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { scrubSentryEvent } from "@/lib/sentryScrub";

Sentry.init({
  dsn: "https://996d46673bc1493b79ee0f764eba7016@o4511225884573696.ingest.us.sentry.io/4511225943883776",

  // Add optional integrations for additional features
  integrations: [Sentry.replayIntegration()],

  // Sample 20% of traces in production to balance cost vs visibility
  tracesSampleRate: 0.2,

  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Replay 10% of sessions normally, but always capture sessions with errors
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  // Enable sending user PII (Personally Identifiable Information)
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  sendDefaultPii: true,

  // Limpia campos sensibles (passwords, tokens, cedulas, referencias de pago)
  // antes de enviar a Sentry. Necesario porque sendDefaultPii: true incluye
  // request bodies que pueden contener datos del checkout.
  beforeSend(event) {
    return scrubSentryEvent(event);
  },

  // iOS Safari cierra agresivamente las conexiones IndexedDB cuando el tab va a
  // background. InstantDB usa IDB internamente para sync/cache y reintenta solo
  // al volver. Estos errores son ruido conocido y no afectan al usuario.
  ignoreErrors: [
    /InvalidStateError.*IDBDatabase.*database connection is closing/i,
    /InvalidStateError.*IDBDatabase.*transaction/i,
    // Promise rejections con un DOM Event (no Error) en tabs iOS resumidos tras
    // suspensión larga — el WebSocket interno de InstantDB intenta reconectar y
    // emite un `Event` de tipo error. Sin stack útil, sin impacto al usuario.
    /Event `Event` \(type=error\) captured as promise rejection/,
  ],
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
