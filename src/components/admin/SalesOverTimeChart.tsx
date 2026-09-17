"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLanguage } from "@/lib/LanguageContext";
import { dateLocale } from "@/lib/i18n";
import { daysBetween } from "@/lib/formatters";
import {
  buildProjection,
  buildSalesSeries,
  type SalesOrder,
} from "@/lib/salesSeries";

export type PhaseMarker = { date: string; label: string };

type Props = {
  orders: SalesOrder[];
  /** Event date, "YYYY-MM-DD". */
  eventDate?: string;
  /** Total capacity, used as the denominator of the projection. */
  capacity: number;
  phaseMarkers?: PhaseMarker[];
};

const HEIGHT = 220;
const PAD_TOP = 22;
const PAD_BOTTOM = 26;
const PAD_LEFT = 34;
const PAD_RIGHT = 42;

const APPROVED_FILL = "var(--accent-light)";
const PENDING_FILL = "var(--accent-light)";
const PENDING_OPACITY = 0.35;
const CUMULATIVE_STROKE = "var(--success)";

const STEP_LADDER = [1, 2, 2.5, 3, 4, 5, 6, 7.5, 10];

/**
 * Picks a readable whole-number step for 4 gridlines, and returns the axis
 * maximum it implies. Working from the step (rather than rounding the maximum)
 * keeps the tick labels integral — these axes only ever count tickets.
 */
function niceAxis(rawMax: number): { max: number; step: number } {
  const target = Math.max(rawMax, 1) / 4;
  const base = 10 ** Math.floor(Math.log10(target));
  const candidate =
    STEP_LADDER.map((m) => m * base).find((s) => s >= target) ?? 10 * base;
  const step = Math.max(1, Math.ceil(candidate));
  return { max: step * 4, step };
}

/** Measures the container so the SVG can be drawn in real pixels (no text scaling). */
function useContainerWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setWidth(Math.round(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { ref, width };
}

export default function SalesOverTimeChart({
  orders,
  eventDate,
  capacity,
  phaseMarkers = [],
}: Props) {
  const { t, lang } = useLanguage();
  const { ref, width } = useContainerWidth();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const series = useMemo(
    () => buildSalesSeries(orders, { eventDate }),
    [orders, eventDate],
  );
  const projection = useMemo(
    () => buildProjection(series, eventDate),
    [series, eventDate],
  );

  const dayLabelFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(dateLocale(lang), {
        day: "2-digit",
        month: "2-digit",
        timeZone: "UTC",
      }),
    [lang],
  );
  const formatDay = (day: string) =>
    dayLabelFmt.format(new Date(`${day}T12:00:00Z`));

  if (!series) {
    return <p className="text-sm text-muted">{t("admin.salesChart.empty")}</p>;
  }

  const { points } = series;
  const count = points.length;
  const plotW = Math.max(0, width - PAD_LEFT - PAD_RIGHT);
  const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const slot = count > 0 ? plotW / count : 0;
  const barW = Math.max(2, Math.min(slot * 0.7, 28));

  const dailyAxis = niceAxis(Math.max(...points.map((p) => p.total), 1));
  const cumulativeAxis = niceAxis(Math.max(series.total, 1));

  const xAt = (i: number) => PAD_LEFT + slot * (i + 0.5);
  const yDaily = (v: number) => PAD_TOP + plotH * (1 - v / dailyAxis.max);
  const yCumulative = (v: number) => PAD_TOP + plotH * (1 - v / cumulativeAxis.max);

  const ticks = [0, 0.25, 0.5, 0.75, 1];

  // Only label as many days as comfortably fit.
  const maxLabels = Math.max(2, Math.floor(plotW / 58));
  const labelStep = Math.max(1, Math.ceil(count / maxLabels));

  const markers = phaseMarkers
    .filter(
      (m) =>
        m.date >= points[0].day && m.date <= points[count - 1].day,
    )
    .map((m) => ({ ...m, index: daysBetween(points[0].day, m.date) }));

  const cumulativePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(2)},${yCumulative(p.cumulative).toFixed(2)}`)
    .join(" ");

  const hovered = hoverIndex != null ? points[hoverIndex] : null;

  function handlePointer(e: React.PointerEvent<SVGSVGElement>) {
    if (slot <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left - PAD_LEFT;
    const i = Math.floor(x / slot);
    setHoverIndex(i >= 0 && i < count ? i : null);
  }

  return (
    <div>
      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: APPROVED_FILL }} />
          {t("common.approved")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="w-2.5 h-2.5 rounded-sm"
            style={{ background: PENDING_FILL, opacity: PENDING_OPACITY }}
          />
          {t("common.pending")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-4 h-0.5 rounded-sm" style={{ background: CUMULATIVE_STROKE }} />
          {t("admin.salesChart.cumulative")}
        </span>
      </div>

      <div ref={ref} className="relative w-full">
        {width > 0 && (
          <svg
            width={width}
            height={HEIGHT}
            className="block touch-pan-y"
            role="img"
            aria-label={t("admin.salesChart.ariaLabel", {
              days: count,
              total: series.total,
            })}
            onPointerMove={handlePointer}
            onPointerLeave={() => setHoverIndex(null)}
          >
            {/* Horizontal grid + both axes */}
            {ticks.map((f) => {
              const y = PAD_TOP + plotH * (1 - f);
              return (
                <g key={f}>
                  <line
                    x1={PAD_LEFT}
                    x2={PAD_LEFT + plotW}
                    y1={y}
                    y2={y}
                    stroke="var(--border)"
                    strokeWidth={1}
                  />
                  <text
                    x={PAD_LEFT - 6}
                    y={y + 3}
                    textAnchor="end"
                    fontSize={9}
                    fill="var(--muted)"
                  >
                    {Math.round(dailyAxis.max * f)}
                  </text>
                  <text
                    x={PAD_LEFT + plotW + 6}
                    y={y + 3}
                    textAnchor="start"
                    fontSize={9}
                    fill={CUMULATIVE_STROKE}
                  >
                    {Math.round(cumulativeAxis.max * f)}
                  </text>
                </g>
              );
            })}

            {/* Price-phase cut-off dates */}
            {markers.map((m) => {
              const x = xAt(m.index);
              const anchor =
                x > PAD_LEFT + plotW - 60 ? "end" : x < PAD_LEFT + 60 ? "start" : "middle";
              return (
                <g key={`${m.date}-${m.label}`}>
                  <line
                    x1={x}
                    x2={x}
                    y1={PAD_TOP}
                    y2={PAD_TOP + plotH}
                    stroke="var(--warning)"
                    strokeOpacity={0.7}
                    strokeWidth={1}
                    strokeDasharray="3 3"
                  />
                  <text
                    x={x}
                    y={PAD_TOP - 8}
                    textAnchor={anchor}
                    fontSize={9}
                    fill="var(--warning)"
                  >
                    {m.label}
                  </text>
                </g>
              );
            })}

            {/* Daily bars: approved, with pending stacked on top */}
            {points.map((p, i) => {
              if (p.total === 0) return null;
              const x = xAt(i) - barW / 2;
              const yApproved = yDaily(p.approved);
              const yTop = yDaily(p.total);
              const base = PAD_TOP + plotH;
              return (
                <g key={p.day}>
                  {p.approved > 0 && (
                    <rect
                      x={x}
                      y={yApproved}
                      width={barW}
                      height={Math.max(1, base - yApproved)}
                      fill={APPROVED_FILL}
                      rx={1}
                    />
                  )}
                  {p.pending > 0 && (
                    <rect
                      x={x}
                      y={yTop}
                      width={barW}
                      height={Math.max(1, yApproved - yTop)}
                      fill={PENDING_FILL}
                      fillOpacity={PENDING_OPACITY}
                      rx={1}
                    />
                  )}
                </g>
              );
            })}

            {/* Cumulative line (right axis) */}
            <path
              d={cumulativePath}
              fill="none"
              stroke={CUMULATIVE_STROKE}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />

            {/* Hover guide */}
            {hoverIndex != null && (
              <line
                x1={xAt(hoverIndex)}
                x2={xAt(hoverIndex)}
                y1={PAD_TOP}
                y2={PAD_TOP + plotH}
                stroke="var(--foreground)"
                strokeOpacity={0.25}
                strokeWidth={1}
              />
            )}

            {/* X axis labels */}
            {points.map((p, i) =>
              i % labelStep === 0 ? (
                <text
                  key={`x-${p.day}`}
                  x={xAt(i)}
                  y={HEIGHT - 8}
                  textAnchor="middle"
                  fontSize={9}
                  fill="var(--muted)"
                >
                  {formatDay(p.day)}
                </text>
              ) : null,
            )}
          </svg>
        )}

        {hovered && (
          <div
            className="pointer-events-none absolute top-0 z-10 bg-surface border border-border rounded-lg shadow-lg px-3 py-2 text-xs whitespace-nowrap"
            style={{
              left: Math.min(Math.max(xAt(hoverIndex as number), 70), Math.max(width - 70, 70)),
              transform: "translateX(-50%)",
            }}
          >
            <p className="font-medium mb-0.5">{formatDay(hovered.day)}</p>
            <p className="text-accent-light">
              {t("common.approved")}: <span className="font-medium">{hovered.approved}</span>
            </p>
            <p className="text-muted">
              {t("common.pending")}: <span className="font-medium">{hovered.pending}</span>
            </p>
            <p className="text-success">
              {t("admin.salesChart.cumulative")}:{" "}
              <span className="font-medium">{hovered.cumulative}</span>
            </p>
          </div>
        )}
      </div>

      {projection && (
        <p className="text-sm text-muted mt-3">
          {t("admin.salesChart.projection", {
            projected: projection.projected,
            capacity,
            date: formatDay(eventDate as string),
          })}
        </p>
      )}
    </div>
  );
}
