import { AQI_CATEGORY_LEGEND_ROWS } from '../../utils/aqiUtils';

export type AqiLegendRangeMode = 'aqi' | 'pm25';
export type AqiLegendVariant = 'embedded' | 'floating';

interface AqiCategoryLegendProps {
  title?: string;
  meta?: string;
  rangeMode?: AqiLegendRangeMode;
  variant?: AqiLegendVariant;
  className?: string;
}

function floatingCategoryLabel(label: string): string {
  if (label === 'Unhealthy for Sensitive Groups') return 'Unhealthy for sensitive groups';
  if (label === 'Very Unhealthy') return 'Very unhealthy';
  return label;
}

function labelTextStyle(label: string): { color?: string } {
  if (label === 'Unhealthy' || label === 'Very Unhealthy' || label === 'Hazardous') {
    return { color: '#fff' };
  }
  if (label === 'Moderate') {
    return { color: '#1f2937' };
  }
  return { color: '#0f172a' };
}

function rangeLabel(
  row: (typeof AQI_CATEGORY_LEGEND_ROWS)[number],
  rangeMode: AqiLegendRangeMode,
  variant: AqiLegendVariant
): string {
  if (rangeMode === 'aqi') return row.aqiRange;
  if (variant === 'floating') return row.pm25RangeShort;
  return row.pm25Range;
}

export default function AqiCategoryLegend({
  title = 'PM₂.₅ · EPA AQI categories',
  meta,
  rangeMode = 'pm25',
  variant = 'embedded',
  className = '',
}: AqiCategoryLegendProps) {
  if (variant === 'floating') {
    return (
      <div
        className={`aaqe-bottom-legend aqi-legend-grid ${className}`.trim()}
        aria-label={title}
        role="img"
      >
        <div className="aaqe-bottom-legend-row aaqe-bottom-legend-row--labels">
          {AQI_CATEGORY_LEGEND_ROWS.map(({ label, color }) => (
            <span
              key={label}
              style={{ background: color, ...labelTextStyle(label) }}
              title={label}
            >
              {floatingCategoryLabel(label)}
            </span>
          ))}
        </div>
        <div className="aaqe-bottom-legend-row aaqe-bottom-legend-row--ranges">
          {AQI_CATEGORY_LEGEND_ROWS.map((row) => (
            <span key={`${row.label}-range`}>{rangeLabel(row, rangeMode, variant)}</span>
          ))}
        </div>
        {meta && <p className="aqi-legend-grid-meta">{meta}</p>}
      </div>
    );
  }

  return (
    <div className={`aaqe-bottom-legend merra2-aqi-legend ${className}`.trim()} aria-label={title}>
      {(title || meta) && (
        <div className="merra2-aqi-legend-header">
          {title && <span className="merra2-aqi-legend-title">{title}</span>}
          {meta && <span className="merra2-aqi-legend-meta">{meta}</span>}
        </div>
      )}
      <div className="aaqe-bottom-legend-row aaqe-bottom-legend-row--labels">
        {AQI_CATEGORY_LEGEND_ROWS.map(({ label, color, shortLabel }) => (
          <span
            key={label}
            style={{ background: color, ...labelTextStyle(label) }}
            title={label}
          >
            {shortLabel}
          </span>
        ))}
      </div>
      <div className="aaqe-bottom-legend-row aaqe-bottom-legend-row--ranges">
        {AQI_CATEGORY_LEGEND_ROWS.map((row) => (
          <span key={`${row.label}-range`}>{rangeLabel(row, rangeMode, variant)}</span>
        ))}
      </div>
    </div>
  );
}
