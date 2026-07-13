import { Chart as ChartJS } from 'chart.js';
import { formatDisplayDate } from '../../utils/dateFormat';
import { formatChartTick } from '../../utils/chartFormat';
import { unionDatesFromSeries } from '../../analysis/alignSeries';
import type { NormalizedSeries } from '../../analysis/types';

const SERIES_COLORS = ['#2563eb', '#dc2626', '#059669', '#7c3aed', '#ea580c'];

/**
 * Copies a live Chart.js canvas and draws value labels at every Nth data point.
 * Handles high-DPI (retina) screens: canvas.width/height are physical pixels but
 * Chart.js element coordinates are logical (CSS) pixels. We scale the context by
 * devicePixelRatio so labels land exactly on the data points.
 */
export function canvasWithValueLabels(srcCanvas: HTMLCanvasElement): HTMLCanvasElement {
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
export function renderCombinedForPdf(
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
