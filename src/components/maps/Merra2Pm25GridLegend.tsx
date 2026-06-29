import {
  PM25_COLORBAR_MAX,
  PM25_COLORBAR_MIN,
  pm25LegendGradientHorizontal,
} from '../../utils/pm25Colormap';

const TICKS = [0, 20, 40, 60, 80, 100];

interface Merra2Pm25GridLegendProps {
  source?: 'gesdisc' | 'sample' | null;
}

export default function Merra2Pm25GridLegend({ source }: Merra2Pm25GridLegendProps) {
  return (
    <div className="merra2-pm25-legend" aria-label="MERRA2 CNN PM2.5 concentration scale">
      <div className="merra2-pm25-legend-header">
        <span className="merra2-pm25-legend-title">MERRA2 CNN Surface PM2.5</span>
        <span className="merra2-pm25-legend-meta">
          µg/m³ · 12 UTC snapshot
          {source === 'sample' && ' · sample data'}
          {source === 'gesdisc' && ' · GES DISC'}
        </span>
      </div>
      <div
        className="merra2-pm25-legend-bar"
        style={{ background: pm25LegendGradientHorizontal(PM25_COLORBAR_MIN, PM25_COLORBAR_MAX) }}
      />
      <div className="merra2-pm25-legend-ticks">
        {TICKS.map((tick, i) => (
          <span key={tick} className="merra2-pm25-legend-tick">
            {i === TICKS.length - 1 ? `${tick}+` : String(tick)}
          </span>
        ))}
      </div>
    </div>
  );
}
