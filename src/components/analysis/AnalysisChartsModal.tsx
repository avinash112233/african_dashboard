import { createPortal } from 'react-dom';
import { useRef, useState } from 'react';
import { jsPDF } from 'jspdf';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import type { TooltipItem } from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';
import { formatDisplayDate } from '../../utils/dateFormat';
import { chartPluginsBase, formatChartTick, tooltipLine } from '../../utils/chartFormat';
import { alignSeriesByDate, unionDatesFromSeries } from '../../analysis/alignSeries';
import type { AnalysisLocationContext, AnalysisVariableId, NormalizedSeries } from '../../analysis/types';
import type { MERRA2StationDailyRecord } from '../../services/merra2Api';
import { anchorSourceLabel } from '../../analysis/locationAnchor';
import './AnalysisChartsModal.css';

ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, Title, Tooltip, Legend
);

const SOURCE_COLOR: Record<string, string> = {
  aeronet: '#2563eb',
  merra2:  '#16a34a',
  aaqe:    '#9333ea',
  firms:   '#dc2626',
};
const SERIES_COLORS = ['#2563eb', '#dc2626', '#059669', '#7c3aed', '#ea580c'];

/**
 * Copies a live Chart.js canvas and draws value labels at every Nth data point.
 * Handles high-DPI (retina) screens: canvas.width/height are physical pixels but
 * Chart.js element coordinates are logical (CSS) pixels. We scale the context by
 * devicePixelRatio so labels land exactly on the data points.
 */
function canvasWithValueLabels(srcCanvas: HTMLCanvasElement): HTMLCanvasElement {
  const dpr  = window.devicePixelRatio || 1;
  const logW = srcCanvas.width  / dpr;
  const logH = srcCanvas.height / dpr;

  const out = document.createElement('canvas');
  out.width  = srcCanvas.width;   // physical pixels
  out.height = srcCanvas.height;
  const ctx  = out.getContext('2d')!;

  // Step 1: copy the physical-resolution chart image 1-to-1
  ctx.drawImage(srcCanvas, 0, 0);

  const chart = ChartJS.getChart(srcCanvas);
  if (!chart) return out;

  const dataset = chart.data.datasets[0];
  if (!dataset) return out;

  const meta  = chart.getDatasetMeta(0);
  // Show at most ~14 labels per chart so they don't overlap
  const step  = Math.max(1, Math.ceil(meta.data.length / 14));
  // Font size in logical pixels (Chart.js element coords are logical)
  const fs    = Math.max(9, Math.round(logW * 0.018));

  // Step 2: scale context so drawing ops use Chart.js logical coordinates
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.font         = `bold ${fs}px system-ui, sans-serif`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'bottom';

  meta.data.forEach((el, i) => {
    if (i % step !== 0) return;
    const raw = dataset.data[i];
    if (raw == null) return;
    const val = typeof raw === 'number' ? raw : (raw as { y?: number }).y ?? null;
    if (val == null) return;

    // getProps returns logical (CSS) pixel coordinates — correct after ctx.scale
    const { x, y } = el.getProps(['x', 'y'], true) as { x: number; y: number };
    if (x < 0 || x > logW || y < 0 || y > logH) return; // skip out-of-chart-area points

    const text = formatChartTick(val);
    const tw   = ctx.measureText(text).width;
    const bw   = tw + 10;
    const bh   = fs + 6;
    const bx   = x - bw / 2;
    const by   = Math.max(2, y - bh - 4);

    // Rounded pill background
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.beginPath();
    const r = 3;
    ctx.moveTo(bx + r, by);
    ctx.lineTo(bx + bw - r, by);
    ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + r);
    ctx.lineTo(bx + bw, by + bh - r);
    ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - r, by + bh);
    ctx.lineTo(bx + r, by + bh);
    ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - r);
    ctx.lineTo(bx, by + r);
    ctx.quadraticCurveTo(bx, by, bx + r, by);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#111827';
    ctx.fillText(text, x, by + bh - 1);
  });

  ctx.restore();
  return out;
}

/**
 * Renders all active series onto a single crisp offscreen canvas for PDF export.
 *
 * Strategy to avoid the double-scale bug:
 *   1. Render the chart at 1× (responsive:false, no devicePixelRatio override)
 *      so Chart.js owns the canvas context transform cleanly.
 *   2. Capture element pixel positions BEFORE destroy.
 *   3. Capture the dataURL BEFORE destroy.
 *   4. Destroy the chart.
 *   5. Create a 2× output canvas, draw the captured image scaled up, then
 *      draw labels at (x*2, y*2) — no ctx.scale needed.
 */
function renderCombinedForPdf(
  seriesList: NormalizedSeries[],
  logW = 1300,
  logH = 700,
): Promise<HTMLCanvasElement> {
  return new Promise((resolve) => {
    const canvas  = document.createElement('canvas');
    canvas.width  = logW;
    canvas.height = logH;

    const dates    = unionDatesFromSeries(seriesList);
    const labels   = dates.map(formatDisplayDate);
    const useDual  = seriesList.length >= 2;
    const maxTicks = Math.min(labels.length, 16);

    const dsConfigs = seriesList.map((s, i) => ({
      label:           `${s.label}${s.unit ? ` (${s.unit})` : ''}`,
      borderColor:     SERIES_COLORS[i % SERIES_COLORS.length],
      backgroundColor: `${SERIES_COLORS[i % SERIES_COLORS.length]}25`,
      data: (() => {
        const byDate = new Map(s.points.map((p) => [p.time.slice(0, 10), p.value]));
        return dates.map((d) => {
          const v = byDate.get(d);
          return v != null && Number.isFinite(v) ? Number(v.toFixed(3)) : null;
        });
      })(),
      pointRadius:     5,
      borderWidth:     2.5,
      tension:         0.25,
      spanGaps:        true,
      fill:            false,
      yAxisID:         i === 0 ? 'y' : 'y1',
    }));

    const chart = new ChartJS(canvas, {
      type: 'line',
      data: { labels, datasets: dsConfigs },
      options: {
        animation:  false,
        responsive: false,
        // No devicePixelRatio override — 1× keeps the ctx transform clean
        layout: { padding: { top: 16, right: 28, bottom: 16, left: 16 } },
        plugins: {
          legend: {
            display:  true,
            position: 'bottom',
            labels: {
              boxWidth:        16,
              font:            { size: 13 },
              padding:         20,
              usePointStyle:   true,
              pointStyleWidth: 16,
              color:           '#111827',
            },
          },
          tooltip: { enabled: false },
        },
        scales: {
          x: {
            grid:  { display: false },
            title: { display: true, text: 'Date', font: { size: 13 }, color: '#374151' },
            ticks: { color: '#374151', font: { size: 11 }, maxRotation: 40, maxTicksLimit: maxTicks },
          },
          y: {
            type:     'linear' as const,
            position: 'left'   as const,
            title:    { display: true, text: seriesList[0]?.unit ?? '', font: { size: 13 }, color: '#374151' },
            ticks:    { color: '#374151', font: { size: 11 }, callback: (v: string | number) => formatChartTick(v) },
            grid:     { color: 'rgba(0,0,0,0.07)' },
          },
          ...(useDual ? {
            y1: {
              type:     'linear' as const,
              position: 'right'  as const,
              title:    { display: true, text: seriesList[1]?.unit ?? '', font: { size: 13 }, color: '#374151' },
              ticks:    { color: '#374151', font: { size: 11 }, callback: (v: string | number) => formatChartTick(v) },
              grid:     { drawOnChartArea: false },
            },
          } : {}),
        },
      },
    });

    // --- Collect element positions (logical px) BEFORE destroy ---
    type LabelPoint = { x: number; y: number; text: string; color: string };
    const labelPoints: LabelPoint[] = [];

    dsConfigs.forEach((ds, di) => {
      const meta = chart.getDatasetMeta(di);
      const step = Math.max(1, Math.ceil(meta.data.length / 12));
      meta.data.forEach((el, i) => {
        if (i % step !== 0) return;
        const raw = ds.data[i];
        if (raw == null) return;
        const val = typeof raw === 'number' ? raw : null;
        if (val == null) return;
        const { x, y } = el.getProps(['x', 'y'], true) as { x: number; y: number };
        if (x >= 0 && x <= logW && y >= 0 && y <= logH) {
          labelPoints.push({ x, y, text: formatChartTick(val), color: ds.borderColor as string });
        }
      });
    });

    // Capture dataURL BEFORE destroy
    const dataUrl = canvas.toDataURL('image/png', 1.0);
    chart.destroy();

    const img = new Image();
    img.onload = () => {
      // 2× output canvas for PDF crispness
      const SCALE = 2;
      const out   = document.createElement('canvas');
      out.width   = logW * SCALE;
      out.height  = logH * SCALE;
      const ctx   = out.getContext('2d')!;

      // Scale up the 1× chart image
      ctx.drawImage(img, 0, 0, out.width, out.height);

      // Draw labels at physical coordinates (logical × SCALE)
      const fs = 11 * SCALE;
      ctx.font         = `bold ${fs}px system-ui, sans-serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'bottom';

      for (const pt of labelPoints) {
        const px = pt.x * SCALE;
        const py = pt.y * SCALE;
        const tw = ctx.measureText(pt.text).width;
        const bw = tw + 10 * SCALE;
        const bh = fs + 5 * SCALE;
        const bx = px - bw / 2;
        const by = Math.max(2, py - bh - 4 * SCALE);

        ctx.fillStyle = 'rgba(255,255,255,0.90)';
        ctx.beginPath();
        const r = 3 * SCALE;
        ctx.moveTo(bx + r, by);
        ctx.lineTo(bx + bw - r, by);
        ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + r);
        ctx.lineTo(bx + bw, by + bh - r);
        ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - r, by + bh);
        ctx.lineTo(bx + r, by + bh);
        ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - r);
        ctx.lineTo(bx, by + r);
        ctx.quadraticCurveTo(bx, by, bx + r, by);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = pt.color;
        ctx.fillText(pt.text, px, by + bh - SCALE);
      }

      resolve(out);
    };
    img.src = dataUrl;
  });
}

// ── Individual chart card ────────────────────────────────────────────────────

interface SingleChartCardProps { series: NormalizedSeries; }

function SingleChartCard({ series }: SingleChartCardProps) {
  const color  = SOURCE_COLOR[series.source] ?? '#6b7280';
  const dates  = unionDatesFromSeries([series]);
  const labels = dates.map(formatDisplayDate);
  const byDate = new Map(series.points.map((p) => [p.time.slice(0, 10), p.value]));
  const data   = dates.map((d) => {
    const v = byDate.get(d);
    return v != null && Number.isFinite(v) ? Number(v.toFixed(3)) : null;
  });

  const isCounts = series.source === 'firms';
  const yLabel   = series.unit ? `${series.label} (${series.unit})` : series.label;

  const scales = {
    x: {
      grid: { display: false },
      title: { display: true, text: 'Date', font: { size: 11 }, color: '#9ca3af' },
      ticks: { color: '#6b7280', font: { size: 11 }, maxRotation: 40, maxTicksLimit: 10 },
    },
    y: {
      title: { display: true, text: yLabel, font: { size: 11 }, color: '#6b7280' },
      ticks: { color: '#6b7280', font: { size: 11 }, callback: (v: string | number) => formatChartTick(v) },
      grid: { color: 'rgba(0,0,0,0.06)' },
      beginAtZero: isCounts,
    },
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      ...chartPluginsBase,
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx: TooltipItem<'line' | 'bar'>) =>
            tooltipLine(series.label, ctx.parsed.y, series.unit),
        },
      },
    },
    scales,
  };

  if (series.points.length === 0) {
    return (
      <div className="acm-card" data-chart-label={series.label}>
        <div className="acm-card-header">
          <span className="acm-dot" style={{ background: color }} />
          <span className="acm-card-title">{series.label}</span>
          <span className="acm-card-unit">{series.unit}</span>
        </div>
        <div className="acm-chart-empty">No data for this period</div>
      </div>
    );
  }

  return (
    <div className="acm-card" data-chart-label={series.label}>
      <div className="acm-card-header">
        <span className="acm-dot" style={{ background: color }} />
        <span className="acm-card-title">{series.label}</span>
        <span className="acm-card-unit">{series.unit}</span>
        <span className="acm-card-count">{series.points.length} pts</span>
      </div>
      <div className="acm-chart-area">
        {isCounts ? (
          <Bar
            data={{ labels, datasets: [{ data, backgroundColor: `${color}99`, borderColor: color, borderWidth: 1, borderRadius: 3 }] }}
            options={options as never}
          />
        ) : (
          <Line
            data={{ labels, datasets: [{ data, borderColor: color, backgroundColor: `${color}20`, pointRadius: 3, pointHoverRadius: 5, borderWidth: 2, tension: 0.25, fill: true, spanGaps: true }] }}
            options={options as never}
          />
        )}
      </div>
    </div>
  );
}

// ── Scatter card ─────────────────────────────────────────────────────────────

interface ScatterCardProps { xSeries: NormalizedSeries; ySeries: NormalizedSeries; }

function ScatterCard({ xSeries, ySeries }: ScatterCardProps) {
  const aligned = alignSeriesByDate([xSeries, ySeries]);
  const points  = aligned.map((row) => ({ x: row.values[xSeries.id], y: row.values[ySeries.id] }));
  const color   = SOURCE_COLOR[xSeries.source] ?? '#2563eb';
  const title   = `${ySeries.label} vs ${xSeries.label}`;

  return (
    <div className="acm-card acm-card-wide" data-chart-label={title}>
      <div className="acm-card-header">
        <span className="acm-dot" style={{ background: color }} />
        <span className="acm-card-title">{title}</span>
        <span className="acm-card-count">{points.length} co-located days</span>
      </div>
      <div className="acm-chart-area">
        {points.length === 0 ? (
          <div className="acm-chart-empty">No co-located data (need overlapping dates in both series)</div>
        ) : (
          <Line
            data={{ datasets: [{ type: 'scatter' as never, data: points as never, backgroundColor: `${color}88`, borderColor: color, pointRadius: 4, pointHoverRadius: 6 }] }}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                ...chartPluginsBase,
                legend: { display: false },
                tooltip: {
                  callbacks: {
                    label: (ctx: TooltipItem<'line'>) =>
                      `${xSeries.label}: ${formatChartTick(ctx.parsed.x)}  |  ${ySeries.label}: ${formatChartTick(ctx.parsed.y)}`,
                  },
                },
              },
              scales: {
                x: {
                  title: { display: true, text: xSeries.unit ? `${xSeries.label} (${xSeries.unit})` : xSeries.label, font: { size: 12 }, color: '#374151' },
                  ticks: { color: '#6b7280', font: { size: 11 }, callback: (v: string | number) => formatChartTick(v) },
                  grid: { color: 'rgba(0,0,0,0.06)' },
                },
                y: {
                  title: { display: true, text: ySeries.unit ? `${ySeries.label} (${ySeries.unit})` : ySeries.label, font: { size: 12 }, color: '#374151' },
                  ticks: { color: '#6b7280', font: { size: 11 }, callback: (v: string | number) => formatChartTick(v) },
                  grid: { color: 'rgba(0,0,0,0.06)' },
                },
              },
            } as never}
          />
        )}
      </div>
    </div>
  );
}

// ── Combined comparison chart (shown in UI + exported to PDF) ─────────────────

interface CombinedChartProps { seriesList: NormalizedSeries[]; }

function CombinedChart({ seriesList }: CombinedChartProps) {
  const dates    = unionDatesFromSeries(seriesList);
  const labels   = dates.map(formatDisplayDate);
  const useDual  = seriesList.length >= 2;

    const datasets = seriesList.map((s, i) => {
      const byDate = new Map(s.points.map((p) => [p.time.slice(0, 10), p.value]));
      return {
        label: `${s.label}${s.unit ? ` (${s.unit})` : ''}`,
        data: dates.map((d) => {
          const v = byDate.get(d);
          return v != null && Number.isFinite(v) ? Number(v.toFixed(3)) : null;
        }),
        borderColor: SERIES_COLORS[i % SERIES_COLORS.length],
        backgroundColor: `${SERIES_COLORS[i % SERIES_COLORS.length]}15`,
        pointRadius: 3,
        pointHoverRadius: 5,
        borderWidth: 2,
        tension: 0.25,
        spanGaps: true,
        fill: false,
        yAxisID: i === 0 ? 'y' : 'y1',
      };
    });

    return (
      <Line
        data={{ labels, datasets }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            ...chartPluginsBase,
            legend: {
              display: true,
              position: 'bottom',
              labels: { boxWidth: 12, font: { size: 11 }, padding: 14, usePointStyle: true, pointStyleWidth: 12 },
            },
          tooltip: {
            callbacks: {
              label: (ctx: TooltipItem<'line'>) =>
                tooltipLine(ctx.dataset.label ?? '', ctx.parsed.y),
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            title: { display: true, text: 'Date', font: { size: 11 }, color: '#9ca3af' },
            ticks: { color: '#374151', font: { size: 10 }, maxRotation: 35 },
          },
          y: {
            type: 'linear' as const,
            position: 'left' as const,
            title: { display: true, text: seriesList[0]?.unit ?? '', font: { size: 11 }, color: '#6b7280' },
            ticks: { color: '#6b7280', font: { size: 11 }, callback: (v: string | number) => formatChartTick(v) },
            grid: { color: 'rgba(0,0,0,0.06)' },
          },
          ...(useDual ? {
            y1: {
              type: 'linear' as const,
              position: 'right' as const,
              title: { display: true, text: seriesList[1]?.unit ?? '', font: { size: 11 }, color: '#6b7280' },
              ticks: { color: '#6b7280', font: { size: 11 }, callback: (v: string | number) => formatChartTick(v) },
              grid: { drawOnChartArea: false },
            },
          } : {}),
        },
      } as never}
    />
  );
}

// ── Modal ────────────────────────────────────────────────────────────────────

interface AnalysisChartsModalProps {
  seriesList: NormalizedSeries[];
  location: AnalysisLocationContext;
  startDate: string;
  endDate: string;
  loading: boolean;
  scatterX: AnalysisVariableId;
  scatterY: AnalysisVariableId;
  onClose: () => void;
  onRefresh: () => void;
  onExport: () => void;
  preloadedStations?: MERRA2StationDailyRecord[];
}

const AnalysisChartsModal = ({
  seriesList,
  location,
  startDate,
  endDate,
  loading,
  scatterX,
  scatterY,
  onClose,
  onRefresh,
  onExport,
}: AnalysisChartsModalProps) => {
  const active   = seriesList.filter((s) => s.points.length > 0);
  const xSeries  = seriesList.find((s) => s.variable === scatterX) ?? seriesList[0];
  const ySeries  = seriesList.find((s) => s.variable === scatterY) ?? seriesList[1];
  const hasData  = active.length > 0;
  const bodyRef  = useRef<HTMLDivElement>(null);
  const [makingPdf, setMakingPdf] = useState(false);

  const handleDownloadPdf = async () => {
    if (!bodyRef.current) return;
    setMakingPdf(true);
    try {
      const pdf      = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const PW       = 297;
      const PH       = 210;
      const M        = 12;
      const HDR_H    = 22;
      const safeLoc  = location.label.replace(/[^\w.-]+/g, '_').slice(0, 30);
      const subtitle = `${location.label}  ·  ${anchorSourceLabel(location.anchorSource)}  ·  ${startDate} – ${endDate}`;

      const addHeader = (label: string) => {
        pdf.setFontSize(9);
        pdf.setTextColor(107, 114, 128);
        pdf.text(subtitle, M, M - 1);
        pdf.setFontSize(15);
        pdf.setTextColor(17, 24, 39);
        pdf.text(label, M, M + 8);
        pdf.setDrawColor(209, 213, 219);
        pdf.setLineWidth(0.4);
        pdf.line(M, M + 11, PW - M, M + 11);
      };

      const addCanvas = (canvas: HTMLCanvasElement) => {
        // Leave some breathing room — cap at 88% of the available area
        const availW  = (PW - M * 2) * 0.88;
        const availH  = (PH - M - HDR_H - M) * 0.88;
        const aspect  = canvas.width / canvas.height;
        let iw = availW;
        let ih = iw / aspect;
        if (ih > availH) { ih = availH; iw = ih * aspect; }
        // Center horizontally and vertically in the available space
        const fullW = PW - M * 2;
        const fullH = PH - M - HDR_H - M;
        const ix = M + (fullW - iw) / 2;
        const iy = M + HDR_H + (fullH - ih) / 2;
        pdf.addImage(canvas.toDataURL('image/png', 1.0), 'PNG', ix, iy, iw, ih);
      };

      let firstPage = true;

      // Pages: one per individual series (with value labels stamped on)
      const cards = Array.from(
        bodyRef.current.querySelectorAll<HTMLDivElement>('[data-chart-label]')
      );

      for (const card of cards) {
        const src = card.querySelector<HTMLCanvasElement>('canvas');
        if (!src) continue;

        const label = card.getAttribute('data-chart-label') ?? 'Chart';
        if (!firstPage) pdf.addPage('a4', 'landscape');
        firstPage = false;

        addHeader(label);
        addCanvas(canvasWithValueLabels(src));
      }

      // Final page: combined comparison (all series on one chart)
      if (active.length >= 2) {
        if (!firstPage) pdf.addPage('a4', 'landscape');
        firstPage = false;
        addHeader('Combined Comparison — All Series');
        const combined = await renderCombinedForPdf(active);
        addCanvas(combined);
      }

      if (firstPage) {
        pdf.setFontSize(11);
        pdf.setTextColor(156, 163, 175);
        pdf.text('No chart data available for the selected variables and date range.', M, PH / 2);
      }

      pdf.save(`analysis_${safeLoc}_${startDate}_${endDate}.pdf`);
    } finally {
      setMakingPdf(false);
    }
  };

  return createPortal(
    <div className="acm-overlay" role="dialog" aria-modal="true" aria-label="Analysis Charts">
      <div className="acm-modal">
        {/* Header */}
        <div className="acm-header">
          <div className="acm-header-left">
            <h4 className="acm-title">{location.label}</h4>
            <span className="acm-subtitle">
              {anchorSourceLabel(location.anchorSource)} · {startDate} – {endDate}
            </span>
          </div>
          <div className="acm-header-actions">
            {hasData && (
              <>
                <button type="button" className="acm-btn" onClick={onRefresh} disabled={loading}>
                  {loading ? 'Loading…' : 'Refresh'}
                </button>
                <button
                  type="button"
                  className="acm-btn acm-btn-primary"
                  onClick={handleDownloadPdf}
                  disabled={makingPdf || loading}
                  title="Download all charts as a PDF — includes value labels at each point and a combined comparison chart"
                >
                  {makingPdf ? 'Building PDF…' : '⬇ Download PDF'}
                </button>
                <button type="button" className="acm-btn" onClick={onExport} title="Download raw time-series data as CSV">
                  ⬇ Download CSV
                </button>
              </>
            )}
            <button type="button" className="acm-close-btn" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="acm-body" ref={bodyRef}>
          {loading && (
            <div className="acm-loading">
              <div className="acm-spinner" />
              <span>Loading analysis data…</span>
            </div>
          )}

          {!loading && seriesList.length === 0 && (
            <p className="acm-empty">Select variables in the sidebar and click Refresh.</p>
          )}

          {!loading && seriesList.length > 0 && (
            <>
              {/* Individual charts — one per variable */}
              <div className="acm-section-label">Individual Series</div>
              <div className="acm-grid">
                {seriesList.map((s) => (
                  <SingleChartCard key={s.id} series={s} />
                ))}
              </div>

              {/* Scatter correlation */}
              {active.length >= 2 && xSeries && ySeries && xSeries.id !== ySeries.id && (
                <>
                  <div className="acm-section-label" style={{ marginTop: 28 }}>Scatter Correlation</div>
                  <div className="acm-grid acm-grid-scatter">
                    <ScatterCard xSeries={xSeries} ySeries={ySeries} />
                  </div>
                </>
              )}

              {/* Combined comparison chart */}
              {active.length >= 2 && (
                <>
                  <div className="acm-section-label" style={{ marginTop: 28 }}>Combined Comparison</div>
                  <div className="acm-combined-chart">
                    <CombinedChart seriesList={active} />
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default AnalysisChartsModal;
