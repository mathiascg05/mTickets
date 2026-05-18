export function playFeedback(kind: "success" | "error"): void {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(kind === "success" ? [80] : [80, 60, 80, 60, 80]);
  }
  if (typeof window === "undefined") return;
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = kind === "success" ? 880 : 220;
    osc.type = "sine";
    osc.connect(gain).connect(ctx.destination);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
    if (kind === "error") {
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.frequency.value = 165;
      osc2.type = "sine";
      osc2.connect(gain2).connect(ctx.destination);
      gain2.gain.setValueAtTime(0.001, ctx.currentTime + 0.18);
      gain2.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.2);
      gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
      osc2.start(ctx.currentTime + 0.18);
      osc2.stop(ctx.currentTime + 0.45);
    }
  } catch {}
}
