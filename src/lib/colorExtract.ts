import { contrastRatio, type EventThemeColors } from "./themeColors";

/**
 * Extracts the dominant color from an image using the Canvas API.
 * Skips near-white and near-black pixels to find a vivid brand color.
 */
export function extractDominantColor(imageUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const size = 50;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas not supported"));
          return;
        }
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);

        // Simple color bucketing — divide each channel into 4 buckets (64 total)
        const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];
          if (a < 128) continue; // skip transparent

          // Skip near-white (luminance > 220) and near-black (luminance < 35)
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          if (lum > 220 || lum < 35) continue;

          // Skip low-saturation grays
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          if (max - min < 20) continue;

          const key = `${Math.floor(r / 64)}-${Math.floor(g / 64)}-${Math.floor(b / 64)}`;
          const existing = buckets.get(key);
          if (existing) {
            existing.count++;
            existing.r += r;
            existing.g += g;
            existing.b += b;
          } else {
            buckets.set(key, { count: 1, r, g, b });
          }
        }

        if (buckets.size === 0) {
          resolve("#1a2b4a"); // fallback to default accent
          return;
        }

        // Find the most common bucket
        let best = { count: 0, r: 0, g: 0, b: 0 };
        for (const bucket of buckets.values()) {
          if (bucket.count > best.count) best = bucket;
        }

        // Average the colors in the winning bucket
        const avgR = Math.round(best.r / best.count);
        const avgG = Math.round(best.g / best.count);
        const avgB = Math.round(best.b / best.count);

        resolve(
          `#${avgR.toString(16).padStart(2, "0")}${avgG.toString(16).padStart(2, "0")}${avgB.toString(16).padStart(2, "0")}`,
        );
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = imageUrl;
  });
}

type Candidate = { hex: string; count: number; h: number; s: number; l: number };

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [h * 360, s, l];
}

function toHex(r: number, g: number, b: number): string {
  return `#${Math.round(r).toString(16).padStart(2, "0")}${Math.round(g).toString(16).padStart(2, "0")}${Math.round(b).toString(16).padStart(2, "0")}`;
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Extracts up to `count` distinct dominant colors from an image.
 * Filters near-monochrome neighbors using HSL distance so the returned list spans the image's palette.
 */
export function extractPalette(imageUrl: string, count = 6): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const size = 64;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas not supported"));
          return;
        }
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);

        const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();
        const lightBuckets = new Map<string, { count: number; r: number; g: number; b: number }>();
        const darkBuckets = new Map<string, { count: number; r: number; g: number; b: number }>();

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];
          if (a < 128) continue;

          const lum = 0.299 * r + 0.587 * g + 0.114 * b;

          // Use finer buckets (32) so we can resolve closer hues
          const key = `${Math.floor(r / 32)}-${Math.floor(g / 32)}-${Math.floor(b / 32)}`;

          if (lum > 230) {
            const entry = lightBuckets.get(key);
            if (entry) {
              entry.count++; entry.r += r; entry.g += g; entry.b += b;
            } else {
              lightBuckets.set(key, { count: 1, r, g, b });
            }
            continue;
          }
          if (lum < 25) {
            const entry = darkBuckets.get(key);
            if (entry) {
              entry.count++; entry.r += r; entry.g += g; entry.b += b;
            } else {
              darkBuckets.set(key, { count: 1, r, g, b });
            }
            continue;
          }
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          if (max - min < 15) continue;

          const entry = buckets.get(key);
          if (entry) {
            entry.count++; entry.r += r; entry.g += g; entry.b += b;
          } else {
            buckets.set(key, { count: 1, r, g, b });
          }
        }

        const toCandidate = (bucket: { count: number; r: number; g: number; b: number }): Candidate => {
          const r = bucket.r / bucket.count;
          const g = bucket.g / bucket.count;
          const b = bucket.b / bucket.count;
          const [h, s, l] = rgbToHsl(r, g, b);
          return { hex: toHex(r, g, b), count: bucket.count, h, s, l };
        };

        const main = Array.from(buckets.values()).map(toCandidate).sort((a, b) => b.count - a.count);
        const lights = Array.from(lightBuckets.values()).map(toCandidate).sort((a, b) => b.count - a.count);
        const darks = Array.from(darkBuckets.values()).map(toCandidate).sort((a, b) => b.count - a.count);

        const picked: Candidate[] = [];
        for (const c of main) {
          if (picked.length >= count) break;
          const tooClose = picked.some(
            (p) => hueDistance(p.h, c.h) < 15 && Math.abs(p.l - c.l) < 0.1 && Math.abs(p.s - c.s) < 0.15,
          );
          if (!tooClose) picked.push(c);
        }
        // Always carry the most prominent light/dark candidate so the mapper can find a background
        if (lights[0]) picked.push(lights[0]);
        if (darks[0]) picked.push(darks[0]);

        if (picked.length === 0) {
          resolve(["#1a2b4a"]);
          return;
        }
        resolve(picked.map((c) => c.hex));
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = imageUrl;
  });
}

function hexHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return rgbToHsl(r, g, b);
}

function mix(a: string, b: string, weightB: number): string {
  const ar = parseInt(a.slice(1, 3), 16);
  const ag = parseInt(a.slice(3, 5), 16);
  const ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16);
  const bg = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  const w = Math.max(0, Math.min(1, weightB));
  return toHex(ar * (1 - w) + br * w, ag * (1 - w) + bg * w, ab * (1 - w) + bb * w);
}

/**
 * Heuristically assigns the candidate palette to accent/background/foreground/surface slots.
 * Always returns valid hex values for all four slots (falls back to defaults if the palette is thin).
 */
export function mapPaletteToTheme(palette: string[]): EventThemeColors {
  if (palette.length === 0) return {};

  const candidates = palette.map((hex) => {
    const [h, s, l] = hexHsl(hex);
    return { hex, h, s, l };
  });

  const saturated = [...candidates].sort((a, b) => b.s - a.s);
  const accent = (saturated.find((c) => c.s >= 0.4) ?? saturated[0]).hex;

  const sortedByLight = [...candidates].sort((a, b) => b.l - a.l);
  const lightCandidate = sortedByLight.find((c) => c.l > 0.8);
  const darkCandidate = [...candidates].sort((a, b) => a.l - b.l).find((c) => c.l < 0.2);

  let background: string;
  if (lightCandidate) background = lightCandidate.hex;
  else if (darkCandidate) background = darkCandidate.hex;
  else background = mix(accent, "#ffffff", 0.94);

  const fgCandidates = candidates.filter((c) => c.hex !== background);
  let foreground = fgCandidates.length > 0
    ? fgCandidates.reduce((best, c) =>
        contrastRatio(c.hex, background) > contrastRatio(best.hex, background) ? c : best,
      ).hex
    : "#1a2b4a";

  if (contrastRatio(foreground, background) < 4.5) {
    foreground = contrastRatio("#1a2b4a", background) > contrastRatio("#ffffff", background)
      ? "#1a2b4a"
      : "#ffffff";
  }

  const surface = mix(background, accent, 0.05);

  return { accent, background, foreground, surface };
}
