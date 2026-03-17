"use client";

import { deriveAccentPalette } from "@/lib/colorUtils";
import { useMemo } from "react";

type Props = {
  concert: { primaryColor?: string };
  children: React.ReactNode;
};

export default function EventTheme({ concert, children }: Props) {
  const style = useMemo(() => {
    if (!concert.primaryColor) return undefined;

    const palette = deriveAccentPalette(concert.primaryColor);
    return {
      "--accent": palette.accent,
      "--accent-dark": palette.accentDark,
      "--accent-light": palette.accentLight,
      "--accent-glow": palette.accentGlow,
    } as React.CSSProperties;
  }, [concert.primaryColor]);

  if (!style) return <>{children}</>;

  return <div style={style}>{children}</div>;
}
