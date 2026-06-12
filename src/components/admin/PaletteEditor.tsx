"use client";

import { useMemo, useRef, useState } from "react";
import { extractPalette, mapPaletteToTheme } from "@/lib/colorExtract";
import {
  contrastRatio,
  isValidHex,
  parseThemeColors,
  resolveCssVars,
  serializeThemeColors,
  type EventThemeColors,
} from "@/lib/themeColors";
import { useStorageUrl } from "@/lib/useStorageUrl";

type SlotKey = "accent" | "background" | "foreground" | "heading" | "surface" | "field" | "border";
const SLOT_KEYS: SlotKey[] = ["accent", "background", "foreground", "heading", "surface", "field", "border"];

const FALLBACKS: Record<SlotKey, string> = {
  accent: "#1a2b4a",
  background: "#f5f7fa",
  foreground: "#1a2b4a",
  heading: "#1a2b4a",
  surface: "#ffffff",
  field: "#f5f7fa",
  border: "#d8dde6",
};

type Props = {
  themeColors?: string;
  paletteRefPath?: string;
  primaryColor?: string;
  uploadingRef?: boolean;
  generating?: boolean;
  onChangeThemeColors: (json: string) => void | Promise<void>;
  onUploadRef: (file: File) => void | Promise<void>;
  onRemoveRef: () => void | Promise<void>;
  onGeneratePalette: (refUrl: string) => void | Promise<void>;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

export default function PaletteEditor({
  themeColors,
  paletteRefPath,
  primaryColor,
  uploadingRef = false,
  generating = false,
  onChangeThemeColors,
  onUploadRef,
  onRemoveRef,
  onGeneratePalette,
  t,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const refUrl = useStorageUrl(paletteRefPath);

  const parsed = useMemo(() => parseThemeColors(themeColors), [themeColors]);

  function update(slot: SlotKey, value: string) {
    const next: EventThemeColors = { ...parsed };
    if (isValidHex(value)) next[slot] = value.toLowerCase();
    onChangeThemeColors(serializeThemeColors(next));
  }

  function resetSlot(slot: SlotKey) {
    const next: EventThemeColors = { ...parsed };
    delete next[slot];
    onChangeThemeColors(serializeThemeColors(next));
  }

  function resetAll() {
    onChangeThemeColors("{}");
  }

  const previewStyle = useMemo(
    () => resolveCssVars(parsed, primaryColor),
    [parsed, primaryColor],
  );

  const effective: Record<SlotKey, string> = {
    accent: parsed.accent ?? (primaryColor && isValidHex(primaryColor) ? primaryColor : FALLBACKS.accent),
    background: parsed.background ?? FALLBACKS.background,
    foreground: parsed.foreground ?? FALLBACKS.foreground,
    heading: parsed.heading ?? parsed.foreground ?? FALLBACKS.heading,
    surface: parsed.surface ?? FALLBACKS.surface,
    field: parsed.field ?? parsed.background ?? FALLBACKS.field,
    border: parsed.border ?? FALLBACKS.border,
  };

  const contrastBg = contrastRatio(effective.foreground, effective.background);
  const contrastSurface = contrastRatio(effective.foreground, effective.surface);
  const lowContrast = contrastBg < 4.5 || contrastSurface < 4.5;

  const hasAny = Object.keys(parsed).length > 0;

  return (
    <div className="mt-5 pt-5 border-t border-border">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center justify-between w-full text-left"
      >
        <span className="text-sm font-medium">{t("admin.customPalette")}</span>
        <span className="text-xs text-muted">{expanded ? "−" : "+"}</span>
      </button>

      {expanded && (
        <div className="mt-4 space-y-5">
          {/* Reference image */}
          <div className="space-y-2">
            <label className="block text-xs font-medium text-muted uppercase">
              {t("admin.paletteRefImage")}
            </label>
            <p className="text-xs text-muted">{t("admin.paletteRefImageHelp")}</p>
            {paletteRefPath ? (
              <div className="space-y-2">
                {refUrl && (
                  <div className="rounded-lg overflow-hidden border border-border bg-background">
                    <img
                      src={refUrl}
                      alt={t("admin.paletteRefImage")}
                      className="w-full h-32 object-cover"
                    />
                  </div>
                )}
                <div className="flex gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => refUrl && onGeneratePalette(refUrl)}
                    disabled={generating || !refUrl}
                    className="text-xs px-3 py-1.5 rounded-md bg-accent text-white hover:bg-accent-dark transition-colors disabled:opacity-50"
                  >
                    {generating ? t("common.loading") : t("admin.generatePaletteFromImage")}
                  </button>
                  <button
                    type="button"
                    onClick={onRemoveRef}
                    className="text-xs px-3 py-1.5 rounded-md text-danger hover:bg-danger/10 transition-colors"
                  >
                    {t("admin.removePaletteRefImage")}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  disabled={uploadingRef}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      await onUploadRef(file);
                      if (fileRef.current) fileRef.current.value = "";
                    }
                  }}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm file:mr-3 file:py-1 file:px-2 file:rounded file:border-0 file:bg-accent/20 file:text-accent-light file:font-medium file:cursor-pointer"
                />
                {uploadingRef && (
                  <p className="text-xs text-muted mt-1 animate-pulse">{t("common.loading")}</p>
                )}
              </div>
            )}
          </div>

          {/* Slot pickers */}
          <div className="space-y-3">
            {SLOT_KEYS.map((slot) => {
              const value = effective[slot];
              const isCustom = parsed[slot] !== undefined;
              return (
                <div key={slot} className="flex items-center gap-3">
                  <input
                    type="color"
                    value={value}
                    onChange={(e) => update(slot, e.target.value)}
                    className="w-10 h-10 rounded-md border border-border bg-transparent cursor-pointer"
                    aria-label={t(`admin.${slot}`)}
                  />
                  <div className="flex-1">
                    <div className="text-xs font-medium">{t(`admin.${slot}`)}</div>
                    <input
                      type="text"
                      value={value}
                      onChange={(e) => update(slot, e.target.value)}
                      placeholder="#000000"
                      className="w-full mt-0.5 px-2 py-1 bg-background border border-border rounded text-xs font-mono"
                    />
                  </div>
                  {isCustom && (
                    <button
                      type="button"
                      onClick={() => resetSlot(slot)}
                      className="text-xs text-muted hover:text-foreground transition-colors"
                    >
                      {t("admin.resetField")}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Contrast warning */}
          {lowContrast && (
            <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
              {t("admin.lowContrastWarning")}
            </div>
          )}

          {/* Preview */}
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted uppercase">
              {t("admin.palettePreview")}
            </div>
            <div
              style={previewStyle}
              className="rounded-xl p-4 border border-border"
            >
              <div className="bg-background rounded-lg p-3">
                <div
                  className="font-semibold text-base mb-2"
                  style={{ color: "var(--heading, var(--foreground))" }}
                >
                  {t("admin.previewHeading")}
                </div>
                <div className="bg-surface rounded-md p-3 mb-3">
                  <div className="text-foreground text-sm mb-1">
                    {t("admin.previewCardText")}
                  </div>
                  <div className="text-muted text-xs mb-2">
                    {t("admin.previewMutedText")}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      placeholder="1"
                      className="bg-field text-foreground border border-border rounded px-2 py-1 text-xs w-16"
                    />
                    <button
                      type="button"
                      className="text-xs px-3 py-1.5 rounded-md bg-accent text-[color:var(--accent-foreground,#ffffff)] font-medium"
                      onClick={(e) => e.preventDefault()}
                    >
                      {t("admin.previewButton")}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {hasAny && (
            <button
              type="button"
              onClick={resetAll}
              className="text-xs text-danger hover:text-danger/80 transition-colors"
            >
              {t("admin.resetAll")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
