/**
 * maTickets logo — monitor with QR-code tickets icon + wordmark.
 *
 * variant="light"  → white icon + white text (for dark backgrounds like headers)
 * variant="dark"   → navy icon + navy/blue text (for light backgrounds like login)
 */
export function LogoIcon({
  size = 28,
  variant = "light",
}: {
  size?: number;
  variant?: "light" | "dark";
}) {
  const primary = variant === "light" ? "#ffffff" : "#1a2b4a";
  const accent = variant === "light" ? "#ffffff" : "#3b5998";
  const ticketFront = variant === "light" ? "#3b5998" : "#3b5998";
  const ticketBack = variant === "light" ? "#6b8cce" : "#2c4a7c";
  const monitorStroke = primary;
  const qrFill = "#ffffff";

  // Scale factor relative to the 300x140 viewBox (icon portion only, no text)
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="30 0 190 135"
      width={size * 1.4}
      height={size}
      aria-hidden="true"
    >
      {/* Monitor body */}
      <rect
        x="60"
        y="10"
        width="130"
        height="100"
        rx="8"
        ry="8"
        fill="none"
        stroke={monitorStroke}
        strokeWidth="6"
        opacity={0.9}
      />
      {/* Monitor screen inner */}
      <rect
        x="68"
        y="18"
        width="114"
        height="76"
        rx="3"
        ry="3"
        fill={primary}
        opacity="0.08"
      />
      {/* Monitor stand */}
      <path
        d="M 110 110 L 105 128 H 145 L 140 110"
        fill="none"
        stroke={monitorStroke}
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.9}
      />
      {/* Monitor base */}
      <line
        x1="95"
        y1="128"
        x2="155"
        y2="128"
        stroke={monitorStroke}
        strokeWidth="5"
        strokeLinecap="round"
        opacity={0.9}
      />

      {/* Back ticket (rotated, behind) */}
      <g transform="translate(148, 18) rotate(18)">
        <rect
          x="0"
          y="0"
          width="50"
          height="80"
          rx="4"
          ry="4"
          fill={ticketBack}
        />
        <circle cx="0" cy="16" r="5" fill="white" />
        <circle cx="50" cy="16" r="5" fill="white" />
        <circle cx="0" cy="64" r="5" fill="white" />
        <circle cx="50" cy="64" r="5" fill="white" />
        <line
          x1="8"
          y1="16"
          x2="42"
          y2="16"
          stroke="white"
          strokeOpacity="0.35"
          strokeWidth="1"
          strokeDasharray="3,3"
        />
        <line
          x1="8"
          y1="64"
          x2="42"
          y2="64"
          stroke="white"
          strokeOpacity="0.35"
          strokeWidth="1"
          strokeDasharray="3,3"
        />
        {/* Mini QR grid */}
        <rect x="14" y="28" width="6" height="6" rx="1" fill={qrFill} opacity="0.4" />
        <rect x="22" y="28" width="6" height="6" rx="1" fill={qrFill} opacity="0.4" />
        <rect x="30" y="28" width="6" height="6" rx="1" fill={qrFill} opacity="0.3" />
        <rect x="14" y="36" width="6" height="6" rx="1" fill={qrFill} opacity="0.3" />
        <rect x="22" y="36" width="6" height="6" rx="1" fill={qrFill} opacity="0.25" />
        <rect x="30" y="36" width="6" height="6" rx="1" fill={qrFill} opacity="0.4" />
        <rect x="14" y="44" width="6" height="6" rx="1" fill={qrFill} opacity="0.4" />
        <rect x="22" y="44" width="6" height="6" rx="1" fill={qrFill} opacity="0.35" />
        <rect x="30" y="44" width="6" height="6" rx="1" fill={qrFill} opacity="0.4" />
      </g>

      {/* Front ticket (bright blue) */}
      <g transform="translate(95, 4)">
        <rect
          x="0"
          y="0"
          width="56"
          height="90"
          rx="5"
          ry="5"
          fill={ticketFront}
        />
        <circle cx="0" cy="18" r="6" fill="white" />
        <circle cx="56" cy="18" r="6" fill="white" />
        <circle cx="0" cy="72" r="6" fill="white" />
        <circle cx="56" cy="72" r="6" fill="white" />
        <line
          x1="8"
          y1="18"
          x2="48"
          y2="18"
          stroke="white"
          strokeOpacity="0.4"
          strokeWidth="1.2"
          strokeDasharray="3,3"
        />
        <line
          x1="8"
          y1="72"
          x2="48"
          y2="72"
          stroke="white"
          strokeOpacity="0.4"
          strokeWidth="1.2"
          strokeDasharray="3,3"
        />
        {/* QR finder patterns */}
        <rect x="12" y="24" width="12" height="12" rx="1" fill={qrFill} opacity="0.9" />
        <rect x="14" y="26" width="8" height="8" rx="0.5" fill={ticketFront} />
        <rect x="16" y="28" width="4" height="4" rx="0.5" fill={qrFill} opacity="0.9" />

        <rect x="32" y="24" width="12" height="12" rx="1" fill={qrFill} opacity="0.9" />
        <rect x="34" y="26" width="8" height="8" rx="0.5" fill={ticketFront} />
        <rect x="36" y="28" width="4" height="4" rx="0.5" fill={qrFill} opacity="0.9" />

        <rect x="12" y="46" width="12" height="12" rx="1" fill={qrFill} opacity="0.9" />
        <rect x="14" y="48" width="8" height="8" rx="0.5" fill={ticketFront} />
        <rect x="16" y="50" width="4" height="4" rx="0.5" fill={qrFill} opacity="0.9" />

        {/* QR data dots */}
        <rect x="27" y="39" width="3" height="3" fill={qrFill} opacity="0.7" />
        <rect x="32" y="39" width="3" height="3" fill={qrFill} opacity="0.5" />
        <rect x="37" y="39" width="3" height="3" fill={qrFill} opacity="0.7" />
        <rect x="27" y="44" width="3" height="3" fill={qrFill} opacity="0.5" />
        <rect x="32" y="44" width="3" height="3" fill={qrFill} opacity="0.7" />
        <rect x="42" y="44" width="3" height="3" fill={qrFill} opacity="0.5" />
        <rect x="27" y="49" width="3" height="3" fill={qrFill} opacity="0.6" />
        <rect x="32" y="49" width="3" height="3" fill={qrFill} opacity="0.4" />
        <rect x="37" y="49" width="3" height="3" fill={qrFill} opacity="0.6" />
        <rect x="42" y="49" width="3" height="3" fill={qrFill} opacity="0.5" />
        <rect x="32" y="54" width="3" height="3" fill={qrFill} opacity="0.5" />
        <rect x="37" y="54" width="3" height="3" fill={qrFill} opacity="0.7" />
        <rect x="42" y="54" width="3" height="3" fill={qrFill} opacity="0.4" />
      </g>

      {/* Sparkle accents */}
      <circle cx="170" cy="12" r="2" fill={accent} opacity="0.6" />
      <circle cx="180" cy="22" r="1.5" fill={accent} opacity="0.4" />
      <circle cx="175" cy="35" r="1.5" fill={accent} opacity="0.5" />
    </svg>
  );
}

export function Logo({
  size = 28,
  variant = "light",
  className = "",
}: {
  size?: number;
  variant?: "light" | "dark";
  className?: string;
}) {
  const textClass =
    variant === "light"
      ? "text-white"
      : "text-accent";
  const fadedClass =
    variant === "light"
      ? "text-white/60"
      : "text-accent/60";

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <LogoIcon size={size} variant={variant} />
      <span className={`font-bold tracking-wide ${textClass}`}>
        ma<span className={fadedClass}>Tickets</span>
      </span>
    </span>
  );
}
