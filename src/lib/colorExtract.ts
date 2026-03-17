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
