// Helpers to detect whether the current browser environment can actually
// open a camera before we hand off to html5-qrcode. The scanner link is
// shared (WhatsApp/Instagram/etc.), and those apps open links inside an
// in-app webview where iOS blocks getUserMedia entirely — there the camera
// never prompts and html5-qrcode rejects with an opaque string. Detecting
// this up front lets us show actionable guidance instead of a generic error.

/** True when the page is served from a secure context (https or localhost). */
export function isSecureContext(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.isSecureContext === "boolean") return window.isSecureContext;
  // Fallback for older browsers without the isSecureContext flag.
  const { protocol, hostname } = window.location;
  return (
    protocol === "https:" ||
    hostname === "localhost" ||
    hostname === "127.0.0.1"
  );
}

/** True when the browser exposes navigator.mediaDevices.getUserMedia. */
export function hasGetUserMedia(): boolean {
  if (typeof navigator === "undefined") return false;
  return !!navigator.mediaDevices?.getUserMedia;
}

/**
 * Detect known in-app browser webviews (WhatsApp, Instagram, Facebook,
 * Messenger, TikTok, Telegram, Line, Snapchat). These commonly block camera
 * access on iOS. Best-effort UA sniffing — only used to tailor the guidance
 * message, never to gate functionality on its own.
 */
export function detectInAppBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return (
    /\bFBAN\b|\bFBAV\b|\bFB_IAB\b/i.test(ua) || // Facebook / Messenger
    /Instagram/i.test(ua) ||
    /WhatsApp/i.test(ua) ||
    /\bLine\//i.test(ua) ||
    /Telegram/i.test(ua) ||
    /TikTok|musical_ly|BytedanceWebview/i.test(ua) ||
    /Snapchat/i.test(ua)
  );
}

/**
 * Classify why the camera can't start before attempting it.
 * Returns null when the environment looks viable.
 */
export function classifyCameraEnv():
  | "insecure"
  | "inAppBrowser"
  | "unsupported"
  | null {
  if (!isSecureContext()) return "insecure";
  if (!hasGetUserMedia()) {
    // No getUserMedia in a secure context almost always means an in-app
    // webview; fall back to "unsupported" only when the UA isn't a known one.
    return detectInAppBrowser() ? "inAppBrowser" : "unsupported";
  }
  return null;
}
