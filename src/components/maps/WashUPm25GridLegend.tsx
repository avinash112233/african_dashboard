import {
  WASHU_COLORBAR_MAX,
  WASHU_COLORBAR_MIN,
  washuLegendGradientHorizontal,
} from '../../utils/washuColormap';
import type { WashUPM25Sample } from './WashUPM25HeatMapLayer';

/** Evenly spaced µg/m³ ticks on the 0–80 WashU color scale */
const TICKS = [0, 20, 40, 60, 80];

interface WashUPm25GridLegendProps {
  source?: 'satpm' | 'sample' | null;
  periodLabel?: string;
  sample?: WashUPM25Sample | null;
}

function formatPm25Value(value: number): string {
  if (value >= 100) return `${Math.round(value)}`;
  if (value >= 10) return value.toFixed(1);
  if (value >= 1) return value.toFixed(2);
  return value.toFixed(3);
}

function samplePositionPercent(value: number): number {
  const span = WASHU_COLORBAR_MAX - WASHU_COLORBAR_MIN;
  if (span <= 0) return 0;
  return Math.max(0, Math.min(100, ((value - WASHU_COLORBAR_MIN) / span) * 100));
}

export default function WashUPm25GridLegend({ source, periodLabel, sample }: WashUPm25GridLegendProps) {
  const hasSample = sample != null && Number.isFinite(sample.value);
  const indicatorLeft = hasSample ? `${samplePositionPercent(sample.value)}%` : undefined;

  return (
    <div className="merra2-pm25-legend washu-pm25-legend" aria-label="WashU SatPM2.5 concentration scale">
      <div className="merra2-pm25-legend-header">
        <span className="merra2-pm25-legend-title">Hybrid PM₂.₅ · WashU SatPM</span>
        <span className="merra2-pm25-legend-meta">
          µg/m³ · {periodLabel ?? '—'} · V6.GL.03 Africa (~0.01°)
          {source === 'sample' && ' · sample data'}
          {source === 'satpm' && ' · AWS satpmdata'}
        </span>
      </div>

      <div className="merra2-pm25-legend-bar-wrap">
        {hasSample && (
          <div
            className="merra2-pm25-legend-value-tag washu-pm25-legend-value-tag"
            style={{ left: indicatorLeft }}
            aria-live="polite"
          >
            {formatPm25Value(sample!.value)} µg/m³
          </div>
        )}
        <div
          className="merra2-pm25-legend-bar washu-pm25-legend-bar"
          style={{ background: washuLegendGradientHorizontal(WASHU_COLORBAR_MIN, WASHU_COLORBAR_MAX) }}
        />
      </div>

      <div className="merra2-pm25-legend-ticks">
        {TICKS.map((tick, i) => (
          <span key={tick} className="merra2-pm25-legend-tick">
            {i === TICKS.length - 1 ? `${tick}+` : String(tick)}
          </span>
        ))}
      </div>

      {hasSample && (
        <div className="merra2-pm25-legend-sample washu-pm25-legend-sample">
          Cursor: {sample!.lat.toFixed(3)}°, {sample!.lon.toFixed(3)}° · PM2.5 {formatPm25Value(sample!.value)} µg/m³
        </div>
      )}
    </div>
  );
}
