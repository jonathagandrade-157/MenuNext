"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { formatCurrencyBRL } from "@/lib/orders";
import type { HourlyMovementPoint } from "@/lib/dashboard";

const WIDTH = 600;
const HEIGHT = 160;
const PADDING = 24;

/**
 * "Movimento de hoje" (redesign Stitch) — gráfico de linha SVG desenhado à
 * mão: o projeto não tem nenhuma biblioteca de gráficos instalada (só
 * `qrcode`) e um gráfico deste tamanho não justifica adicionar uma
 * dependência nova só para isto.
 */
export function MovementChart({ points }: { points: HourlyMovementPoint[] }) {
  const [metric, setMetric] = useState<"orders" | "revenue">("orders");

  const values = points.map((p) => p[metric]);
  const maxValue = Math.max(1, ...values);
  const stepX = points.length > 1 ? (WIDTH - PADDING * 2) / (points.length - 1) : 0;

  const coords = points.map((p, i) => ({
    x: PADDING + i * stepX,
    y: HEIGHT - PADDING - (p[metric] / maxValue) * (HEIGHT - PADDING * 2),
  }));

  const linePath = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L ${coords[coords.length - 1]?.x ?? PADDING} ${HEIGHT - PADDING} L ${PADDING} ${HEIGHT - PADDING} Z`;

  const peakIndex = values.indexOf(maxValue);

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-extrabold text-graphite">Movimento de hoje</h2>
          <p className="text-xs text-text-muted">Pedidos e faturamento ao longo do dia</p>
        </div>
        <div className="flex gap-1 rounded-lg bg-surface-subdued p-1">
          {(["orders", "revenue"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setMetric(value)}
              className={`rounded-md px-3 py-1 text-xs font-bold transition-colors ${
                metric === value ? "bg-white text-graphite shadow-sm" : "text-text-muted"
              }`}
            >
              {value === "orders" ? "Pedidos" : "Faturamento"}
            </button>
          ))}
        </div>
      </div>

      {values.every((v) => v === 0) ? (
        <p className="py-10 text-center text-sm text-text-muted">Nenhum pedido hoje ainda.</p>
      ) : (
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="mt-4 w-full" role="img" aria-label="Gráfico de movimento por hora">
          <path d={areaPath} fill="var(--color-primary, #f95721)" opacity={0.08} />
          <path d={linePath} fill="none" stroke="var(--color-primary, #f95721)" strokeWidth={2} />
          {coords.map((c, i) => (
            <circle key={i} cx={c.x} cy={c.y} r={i === peakIndex ? 4 : 2} fill="var(--color-primary, #f95721)" />
          ))}
        </svg>
      )}

      <div className="mt-1 flex justify-between text-[10px] text-text-muted">
        <span>{String(points[0]?.hour ?? 0).padStart(2, "0")}h</span>
        {points.length > 1 && <span>{String(points[points.length - 1].hour).padStart(2, "0")}h</span>}
      </div>

      {maxValue > 0 && (
        <p className="mt-2 text-xs font-medium text-text-muted">
          Pico às {String(points[peakIndex]?.hour ?? 0).padStart(2, "0")}h —{" "}
          {metric === "orders" ? `${values[peakIndex]} pedidos` : formatCurrencyBRL(values[peakIndex])}
        </p>
      )}
    </Card>
  );
}
