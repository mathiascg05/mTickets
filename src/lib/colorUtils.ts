/**
 * Derives an accent color palette from a single hex color.
 * Returns CSS variable overrides for --accent, --accent-dark, --accent-light, --accent-glow.
 */

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return [0, 0, l];

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;

  return [h * 360, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  const hNorm = h / 360;

  if (s === 0) {
    const val = Math.round(l * 255);
    return `#${val.toString(16).padStart(2, "0")}${val.toString(16).padStart(2, "0")}${val.toString(16).padStart(2, "0")}`;
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  const r = Math.round(hue2rgb(p, q, hNorm + 1 / 3) * 255);
  const g = Math.round(hue2rgb(p, q, hNorm) * 255);
  const b = Math.round(hue2rgb(p, q, hNorm - 1 / 3) * 255);

  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

export type AccentPalette = {
  accent: string;
  accentDark: string;
  accentLight: string;
  accentGlow: string;
};

export function deriveAccentPalette(hex: string): AccentPalette {
  const [h, s, l] = hexToHsl(hex);

  return {
    accent: hex,
    accentDark: hslToHex(h, s, Math.max(0, l - 0.15)),
    accentLight: hslToHex(h, s, Math.min(1, l + 0.15)),
    accentGlow: hslToHex(h, s, Math.min(1, l + 0.25)),
  };
}
