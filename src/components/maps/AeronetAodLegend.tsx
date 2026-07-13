import { AOD_CLASSIFICATION_LEGEND } from '../../utils/aodUtils';

const AOD_MAP_LEGEND = [
  ...AOD_CLASSIFICATION_LEGEND,
  { range: '—', label: 'No data', color: 'rgba(128, 128, 128, 0.85)' },
] as const;

function labelTextColor(background: string): string {
  if (background.includes('128')) return '#ffffff';
  if (background === '#dc2626') return '#ffffff';
  return '#111827';
}

export default function AeronetAodLegend() {
  return (
    <div className="aaqe-bottom-legend aeronet-aod-bottom-legend" aria-label="AERONET AOD classification scale">
      <div className="aaqe-bottom-legend-row aaqe-bottom-legend-row--labels aeronet-aod-legend-row">
        {AOD_MAP_LEGEND.map(({ label, color }) => (
          <span
            key={label}
            style={{ background: color, color: labelTextColor(color) }}
          >
            {label}
          </span>
        ))}
      </div>
      <div className="aaqe-bottom-legend-row aaqe-bottom-legend-row--ranges aeronet-aod-legend-row">
        {AOD_MAP_LEGEND.map(({ range, label }) => (
          <span key={`${label}-range`}>{range}</span>
        ))}
      </div>
    </div>
  );
}
