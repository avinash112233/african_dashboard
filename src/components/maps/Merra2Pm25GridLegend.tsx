import {
  PM25_COLORBAR_MAX,
  PM25_COLORBAR_MIN,
  pm25LegendGradientHorizontal,
} from '../../utils/pm25Colormap';
import type { PM25Sample } from './PM25HeatMapLayer';

const TICKS = [0, 20, 40, 60, 80, 100];

interface Merra2Pm25GridLegendProps {
  source?: 'gesdisc' | 'sample' | null;
  hour?: number;
  sample?: PM25Sample | null;
}

function formatPm25Value(value: number): string {
  if (value >= 100) return `${Math.round(value)}`;
  if (value >= 10) return value.toFixed(1);
  if (value >= 1) return value.toFixed(2);
  return value.toFixed(3);
}

function samplePositionPercent(value: number): number {
  const span = PM25_COLORBAR_MAX - PM25_COLORBAR_MIN;
  if (span <= 0) return 0;
  return Math.max(0, Math.min(100, ((value - PM25_COLORBAR_MIN) / span) * 100));
}

export default function Merra2Pm25GridLegend({ source, hour = 12, sample }: Merra2Pm25GridLegendProps) {
  const hasSample = sample != null && Number.isFinite(sample.value);
  const indicatorLeft = hasSample ? `${samplePositionPercent(sample.value)}%` : undefined;

  return (
    <div className="merra2-pm25-legend" aria-label="MERRA2 CNN PM2.5 concentration scale">
      <div className="merra2-pm25-legend-header">
        <span className="merra2-pm25-legend-title">MERRA2 CNN Surface PM2.5</span>
        <span className="merra2-pm25-legend-meta">
          µg/m³ · hour {String(hour).padStart(2, '0')} UTC
          {source === 'sample' && ' · sample data'}
          {source === 'gesdisc' && ' · GES DISC'}
        </span>
      </div>

      <div className="merra2-pm25-legend-bar-wrap">
        {hasSample && (
          <div
            className="merra2-pm25-legend-value-tag"
            style={{ left: indicatorLeft }}
            aria-live="polite"
          >
            {formatPm25Value(sample.value)} µg/m³
          </div>
        )}
        <div
          className="merra2-pm25-legend-bar"
          style={{ background: pm25LegendGradientHorizontal(PM25_COLORBAR_MIN, PM25_COLORBAR_MAX) }}
        >
          {hasSample && (
            <div
              className="merra2-pm25-legend-indicator"
              style={{ left: indicatorLeft }}
              aria-hidden="true"
            />
          )}
        </div>
      </div>

      <div className="merra2-pm25-legend-ticks">
        {TICKS.map((tick, i) => (
          <span key={tick} className="merra2-pm25-legend-tick">
            {i === TICKS.length - 1 ? `${tick}+` : String(tick)}
          </span>
        ))}
      </div>

      {!hasSample && (
        <p className="merra2-pm25-legend-hint">Move cursor over the map to read PM2.5 at a point</p>
      )}
    </div>
  );
}
