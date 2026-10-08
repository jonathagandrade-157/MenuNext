import type { ChartGeometry } from "@/lib/masterDashboard";

/** Medidas do gráfico: a geometria (buildGrowthChart) e o <svg> precisam usar
 * as mesmas, por isso ficam juntas aqui. */
export const LINE_CHART_SIZE = { width: 600, height: 220, padX: 28, padY: 24 };

/** Gráfico de linha em SVG próprio (sem biblioteca). `labelStep` mostra um
 * rótulo do eixo X a cada N pontos, contando a partir do último. */
export function LineChart({
  chart,
  ariaLabel,
  tooltip,
  labelStep = 2,
}: {
  chart: ChartGeometry;
  ariaLabel: string;
  tooltip: (dot: ChartGeometry["dots"][number]) => string;
  labelStep?: number;
}) {
  const { width, height, padX, padY } = LINE_CHART_SIZE;
  const lastIndex = chart.dots.length - 1;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full text-primary" role="img" aria-label={ariaLabel}>
      <line x1={padX} x2={width - padX} y1={height - padY} y2={height - padY} stroke="currentColor" strokeOpacity="0.15" />
      {chart.area && <path d={chart.area} fill="currentColor" fillOpacity="0.1" />}
      {chart.line && (
        <path d={chart.line} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      )}
      {chart.dots.map((dot, index) => (
        <g key={`${dot.label}-${index}`}>
          <circle cx={dot.x} cy={dot.y} r={index === lastIndex ? 5 : 3} fill="currentColor">
            <title>{tooltip(dot)}</title>
          </circle>
          {(lastIndex - index) % labelStep === 0 && (
            <text x={dot.x} y={height - 6} textAnchor="middle" fontSize="11" className="fill-text-muted">
              {dot.label}
            </text>
          )}
        </g>
      ))}
      {lastIndex >= 0 && (
        <text
          x={chart.dots[lastIndex].x}
          y={chart.dots[lastIndex].y - 12}
          textAnchor="end"
          fontSize="13"
          fontWeight="700"
          className="fill-graphite"
        >
          {chart.dots[lastIndex].value}
        </text>
      )}
    </svg>
  );
}
