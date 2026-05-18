import type React from "react";
import { deriveAccentPalette } from "./colorUtils";

export type EventThemeColors = {
  accent?: string;
  background?: string;
  foreground?: string;
  surface?: string;
  field?: string;
};

const HEX_RE = /^#[0-9a-f]{6}$/i;

export function isValidHex(s: string): boolean {
  return HEX_RE.test(s);
}

export function parseThemeColors(json?: string | null): EventThemeColors {
  if (!json) return {};
  try {
    const raw = JSON.parse(json);
    if (!raw || typeof raw !== "object") return {};
    const out: EventThemeColors = {};
    for (const key of ["accent", "background", "foreground", "surface", "field"] as const) {
      const v = (raw as Record<string, unknown>)[key];
      if (typeof v === "string" && isValidHex(v)) out[key] = v.toLowerCase();
    }
    return out;
  } catch {
    return {};
  }
}

export function serializeThemeColors(t: EventThemeColors): string {
  const clean: EventThemeColors = {};
  for (const key of ["accent", "background", "foreground", "surface", "field"] as const) {
    const v = t[key];
    if (typeof v === "string" && isValidHex(v)) clean[key] = v.toLowerCase();
  }
  return JSON.stringify(clean);
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${clamp(r).toString(16).padStart(2, "0")}${clamp(g).toString(16).padStart(2, "0")}${clamp(b).toString(16).padStart(2, "0")}`;
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(fg: string, bg: string): number {
  if (!isValidHex(fg) || !isValidHex(bg)) return 1;
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function hasReadableContrast(fg: string, bg: string): boolean {
  return contrastRatio(fg, bg) >= 4.5;
}

function mixHex(a: string, b: string, weightB: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const w = Math.max(0, Math.min(1, weightB));
  return rgbToHex(r1 * (1 - w) + r2 * w, g1 * (1 - w) + g2 * w, b1 * (1 - w) + b2 * w);
}

export function resolveCssVars(
  themeColors: EventThemeColors,
  primaryColor?: string,
): React.CSSProperties {
  const style: Record<string, string> = {};

  const accent =
    themeColors.accent ?? (primaryColor && isValidHex(primaryColor) ? primaryColor : undefined);

  if (accent) {
    const palette = deriveAccentPalette(accent);
    style["--accent"] = palette.accent;
    style["--accent-dark"] = palette.accentDark;
    style["--accent-light"] = palette.accentLight;
    style["--accent-glow"] = palette.accentGlow;
  }

  if (themeColors.background) {
    style["--background"] = themeColors.background;
    if (!themeColors.field) style["--field"] = themeColors.background;
  }
  if (themeColors.foreground) style["--foreground"] = themeColors.foreground;
  if (themeColors.surface) {
    style["--surface"] = themeColors.surface;
    const hoverBase = themeColors.foreground ?? "#1a2b4a";
    style["--surface-hover"] = mixHex(themeColors.surface, hoverBase, 0.04);
  }
  if (themeColors.field) style["--field"] = themeColors.field;

  return style as React.CSSProperties;
}
