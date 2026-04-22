"use client";

/**
 * SoldCompsChart — visualises sold comp prices over time.
 *
 * Graph types:
 *   scatter_bestfit  — scatter plot with linear regression line (default)
 *   scatter          — scatter plot, no trend line
 *   line             — line chart connecting active comps chronologically
 *   bar              — price distribution histogram
 *
 * Active comps (in-window, not excluded) are fully opaque.
 * Dimmed comps (excluded or outside the selected window) are shown at low opacity.
 */

import { useState } from "react";
import {
  ComposedChart,
  Scatter,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { regressionLinePoints } from "@/lib/utils/regression";
import type { SoldComp, CompWindowDays } from "@/lib/api";

type ChartType = "scatter_bestfit" | "scatter" | "line" | "bar";

interface ScatterPoint {
  x: number;
  y: number;
  title: string;
}

interface Props {
  comps: SoldComp[];
  window: CompWindowDays;
}

function buildPriceBins(prices: number[], binCount = 8): { label: string; count: number }[] {
  if (prices.length === 0) return [];
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const size  = range / binCount;
  const bins  = Array.from({ length: binCount }, (_, i) => ({
    label: `$${Math.round(min + i * size)}`,
    min:   min + i * size,
    max:   min + (i + 1) * size,
    count: 0,
  }));
  prices.forEach((p) => {
    const idx = Math.min(Math.floor((p - min) / size), binCount - 1);
    bins[idx].count++;
  });
  return bins.map((b) => ({ label: b.label, count: b.count }));
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function CustomScatterTooltip({ active, payload }: { active?: boolean; payload?: { payload: ScatterPoint }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-background border rounded-lg px-3 py-2 text-xs shadow-lg max-w-[220px]">
      <p className="font-medium">${d.y.toFixed(2)}</p>
      <p className="text-muted-foreground">{formatDate(d.x)}</p>
      {d.title && <p className="text-muted-foreground truncate mt-0.5">{d.title}</p>}
    </div>
  );
}

export function SoldCompsChart({ comps, window }: Props) {
  const [chartType, setChartType] = useState<ChartType>("scatter_bestfit");

  const now      = Date.now();
  const cutoffMs = window * 24 * 60 * 60 * 1000;

  const allPoints = comps
    .filter((c) => c.sold_date)
    .map((c) => ({
      x:        new Date(c.sold_date!).getTime(),
      y:        c.price,
      title:    c.title,
      excluded: c.excluded,
      inWindow: now - new Date(c.sold_date!).getTime() <= cutoffMs,
    }));

  const activePoints: ScatterPoint[] = allPoints
    .filter((p) => !p.excluded && p.inWindow)
    .map(({ x, y, title }) => ({ x, y, title }));

const regLine = chartType === "scatter_bestfit" && activePoints.length >= 2
    ? regressionLinePoints(activePoints)
    : [];

  const lineData = [...activePoints].sort((a, b) => a.x - b.x);

  const bins = buildPriceBins(activePoints.map((p) => p.y));

  const activeX = activePoints.map((p) => p.x);
  const domainX: [number, number] = activeX.length
    ? [Math.min(...activeX), Math.max(...activeX)]
    : [0, 1];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Price History
        </p>
        <select
          value={chartType}
          onChange={(e) => setChartType(e.target.value as ChartType)}
          className="border rounded px-2 py-1 text-xs bg-background"
        >
          <option value="scatter_bestfit">Scatter + Best Fit</option>
          <option value="scatter">Scatter</option>
          <option value="line">Line</option>
          <option value="bar">Price Distribution</option>
        </select>
      </div>

      <ResponsiveContainer width="100%" height={280}>
        {chartType === "bar" ? (
          <BarChart data={bins} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={28} />
            <Tooltip
              contentStyle={{ fontSize: 12 }}
              formatter={(v: number) => [v, "Sales"]}
            />
            <Bar dataKey="count" fill="#3b82f6" radius={[3, 3, 0, 0]} />
          </BarChart>
        ) : chartType === "line" ? (
          <ComposedChart
            data={lineData}
            margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="x"
              type="number"
              scale="time"
              domain={domainX}
              tickFormatter={formatDate}
              tick={{ fontSize: 10 }}
              minTickGap={40}
            />
            <YAxis
              dataKey="y"
              tickFormatter={(v: number) => `$${v}`}
              tick={{ fontSize: 10 }}
              width={52}
            />
            <Tooltip content={<CustomScatterTooltip />} />
            <Line
              type="monotone"
              dataKey="y"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={{ r: 3, fill: "#3b82f6" }}
              activeDot={{ r: 5 }}
            />
          </ComposedChart>
        ) : (
          /* scatter and scatter_bestfit */
          <ComposedChart
            data={regLine}
            margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="x"
              type="number"
              scale="time"
              domain={domainX}
              tickFormatter={formatDate}
              tick={{ fontSize: 10 }}
              minTickGap={40}
            />
            <YAxis
              dataKey="y"
              tickFormatter={(v: number) => `$${v}`}
              tick={{ fontSize: 10 }}
              width={52}
            />
            <Tooltip content={<CustomScatterTooltip />} />
            {chartType === "scatter_bestfit" && regLine.length > 0 && (
              <Line
                type="linear"
                dataKey="y"
                dot={false}
                stroke="#f97316"
                strokeWidth={2}
                strokeDasharray="4 2"
              />
            )}
            <Scatter data={activePoints} fill="#3b82f6" fillOpacity={0.85} />
          </ComposedChart>
        )}
      </ResponsiveContainer>

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-500" /> Active
        </span>
{chartType === "scatter_bestfit" && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-4 border-t-2 border-dashed border-orange-400" /> Best fit
          </span>
        )}
      </div>
    </div>
  );
}
