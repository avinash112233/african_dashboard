import { getAqiCategory, calculateAQIFromPm25 } from '../utils/aqiUtils';
import { formatDateMonthDayYear, normalizeAeronetDate } from '../utils/dateFormat';
import { computeDailyMeanAOD, getAODLevelColor, getAODLevelLabel } from '../utils/aodUtils';
import { hasOpenAqPm25Value, type OpenAqStationRecord } from '../services/openaqApi';
import type { MERRA2StationDailyRecord } from '../services/merra2Api';
import type { AERONETDataPoint, AERONETSite } from '../services/aeronetApi';
import type { SelectedAAQEData, SelectedFireData } from './types';

function fmtHourCode(code: string): string {
  const p = code.padStart(4, '0');
  return `${p.slice(0, 2)}:${p.slice(2)} UTC`;
}

/** Readable text color for AQI value displayed on a white/light background. */
function getAqiTextColor(aqi: number | null): string {
  if (aqi == null || !Number.isFinite(aqi)) return '#6b7280';
  if (aqi <= 50) return '#16a34a';
  if (aqi <= 100) return '#a16207';
  if (aqi <= 150) return '#c2410c';
  if (aqi <= 200) return '#b91c1c';
  if (aqi <= 300) return '#7e22ce';
  return '#7f1d1d';
}

export interface AaqeSelectedPanelProps {
  data: SelectedAAQEData;
  threeDayRows: Array<{ label: string; date: string; aqi: number }>;
}

export function AaqeSelectedPanel({ data, threeDayRows }: AaqeSelectedPanelProps) {
  const aqiCat = getAqiCategory(data.dailyAqi ?? null);
  const aqiBgColor = aqiCat.color;
  const aqiTxtColor = getAqiTextColor(data.dailyAqi ?? null);

  const aqiByCode = new Map(
    data.hourlyAqi.map((h) => {
      const m = h.label.match(/\((\d+)\)/);
      return [m?.[1] ?? h.label, h.value] as [string, number];
    })
  );

  return (
    <div className="aaqe-panel">
      <div className="aaqe-panel-header">
        <p className="aaqe-panel-site">{data.siteName ?? 'Unknown Site'}</p>
        <p className="aaqe-panel-meta">AAQE PM2.5 Forecast</p>
        {data.utcDate && <p className="aaqe-panel-meta">Forecast date: {data.utcDate}</p>}
        <p className="aaqe-panel-meta">
          {data.latitude.toFixed(4)}°, {data.longitude.toFixed(4)}°
        </p>
      </div>

      <div className="aaqe-metrics-row">
        <div className="aaqe-metric-card" style={{ borderTop: `3px solid ${aqiBgColor}` }}>
          <div className="aaqe-metric-value" style={{ color: aqiTxtColor }}>
            {data.dailyAqi ?? '—'}
          </div>
          <div className="aaqe-metric-label">Daily AQI</div>
          <div className="aaqe-metric-cat" style={{ color: aqiTxtColor }}>
            {aqiCat.label}
          </div>
        </div>
        <div className="aaqe-metric-card">
          <div className="aaqe-metric-value" style={{ color: '#1f2937' }}>
            {data.selectedPm?.toFixed(1) ?? '—'}
          </div>
          <div className="aaqe-metric-label">PM2.5 (µg/m³)</div>
          <div className="aaqe-metric-cat" style={{ color: '#6b7280' }}>
            {data.selectedTimeCode
              ? `at ${fmtHourCode(String(data.selectedTimeCode))}`
              : '3-hourly'}
          </div>
        </div>
      </div>

      {data.hourlyPm.length > 0 && (
        <>
          <div className="aaqe-section-label">3-Hour Intervals</div>
          <table className="aaqe-hourly-table">
            <thead>
              <tr>
                <th>Time (UTC)</th>
                <th>PM2.5</th>
                <th>AQI</th>
              </tr>
            </thead>
            <tbody>
              {data.hourlyPm.map((h) => {
                const m = h.label.match(/\((\d+)\)/);
                const code = m?.[1] ?? '';
                const aqi = aqiByCode.get(code);
                const cat = getAqiCategory(aqi ?? null);
                const txtC = getAqiTextColor(aqi ?? null);
                const isSelected = String(data.selectedTimeCode) === code;
                return (
                  <tr key={h.label} className={isSelected ? 'aaqe-row-selected' : ''}>
                    <td>{fmtHourCode(code)}</td>
                    <td>{h.value.toFixed(2)}</td>
                    <td>
                      {aqi != null ? (
                        <span
                          className="aaqe-aqi-badge"
                          style={{
                            background: cat.color + '30',
                            color: txtC,
                            borderColor: cat.color,
                          }}
                        >
                          {Math.round(aqi)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      {threeDayRows.length > 0 && (
        <>
          <div className="aaqe-section-label">3-Day Outlook</div>
          <div className="aaqe-threeday-grid">
            {threeDayRows.map((r) => {
              const c = getAqiCategory(r.aqi);
              const txtC = getAqiTextColor(r.aqi);
              return (
                <div
                  key={`${r.label}-${r.date}`}
                  className="aaqe-threeday-card"
                  style={{ borderTop: `3px solid ${c.color}` }}
                >
                  <div className="aaqe-threeday-day">{r.label}</div>
                  <div className="aaqe-threeday-date">{r.date}</div>
                  <div className="aaqe-threeday-aqi" style={{ color: txtC }}>
                    {Math.round(r.aqi)}
                  </div>
                  <div className="aaqe-threeday-cat" style={{ color: txtC }}>
                    {c.label}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <p className="data-source-footer">Source: AERONET AAQE GeoJSON</p>
    </div>
  );
}

export interface Merra2SelectedPanelProps {
  station: MERRA2StationDailyRecord;
  aqi: number | null;
  dataDate: string;
  metricsLoading?: boolean;
}

export function Merra2SelectedPanel({ station, aqi, dataDate, metricsLoading }: Merra2SelectedPanelProps) {
  const aqiCat = getAqiCategory(aqi);
  const aqiBgColor = aqiCat.color;
  const aqiTxtColor = getAqiTextColor(aqi);

  return (
    <div className="merra2-panel">
      <div className="merra2-panel-header">
        <p className="merra2-panel-site">{station.sitename}</p>
        <p className="merra2-panel-meta">MERRA2 CNN PM2.5 Station</p>
        {station.country && <p className="merra2-panel-meta">{station.country}</p>}
        <p className="merra2-panel-meta">
          {station.latitude.toFixed(4)}°, {station.longitude.toFixed(4)}°
        </p>
        <p className="merra2-panel-meta">Data date: {formatDateMonthDayYear(dataDate)}</p>
      </div>

      <div className="aaqe-metrics-row">
        <div
          className="aaqe-metric-card"
          style={{ borderTop: `3px solid ${metricsLoading ? '#d1d5db' : aqiBgColor}` }}
        >
          <div
            className="aaqe-metric-value"
            style={{ color: metricsLoading ? '#9ca3af' : aqiTxtColor }}
          >
            {metricsLoading ? '…' : (aqi ?? '—')}
          </div>
          <div className="aaqe-metric-label">AQI</div>
          <div
            className="aaqe-metric-cat"
            style={{ color: metricsLoading ? '#9ca3af' : aqiTxtColor }}
          >
            {metricsLoading ? 'Updating…' : aqiCat.label}
          </div>
        </div>
        <div className="aaqe-metric-card">
          <div
            className="aaqe-metric-value"
            style={{ color: metricsLoading ? '#9ca3af' : '#1f2937' }}
          >
            {metricsLoading ? '…' : station.pm25.toFixed(1)}
          </div>
          <div className="aaqe-metric-label">PM2.5 (µg/m³)</div>
          <div className="aaqe-metric-cat" style={{ color: '#6b7280' }}>
            daily average
          </div>
        </div>
      </div>

      {station.fullAddress && (
        <div className="merra2-panel-address">
          <span className="aaqe-section-label" style={{ display: 'inline', marginBottom: 0 }}>
            Location:{' '}
          </span>
          {station.fullAddress}
        </div>
      )}

      <p className="data-source-footer">Source: MERRA2 parquet station archive</p>
    </div>
  );
}

export interface OpenAqSelectedPanelProps {
  station: OpenAqStationRecord;
  aqi: number | null;
  dataDate: string;
  metricsLoading?: boolean;
}

export function OpenAqSelectedPanel({ station, aqi, dataDate, metricsLoading }: OpenAqSelectedPanelProps) {
  const aqiCat = getAqiCategory(aqi);
  const aqiBgColor = aqiCat.color;
  const aqiTxtColor = getAqiTextColor(aqi);
  const statLabel = station.mode === 'latest' ? 'latest reading' : 'daily mean (local day)';
  const readingDateStr =
    station.datetime?.slice(0, 10) || station.datetimeLast?.slice(0, 10) || dataDate;
  const displayDate = station.mode === 'latest' ? readingDateStr : dataDate;

  return (
    <div className="merra2-panel">
      <div className="merra2-panel-header">
        <p className="merra2-panel-site">{station.name}</p>
        <p className="merra2-panel-meta">OpenAQ Ground Monitor</p>
        {station.country && <p className="merra2-panel-meta">{station.country}</p>}
        {station.provider && <p className="merra2-panel-meta">{station.provider}</p>}
        <p className="merra2-panel-meta">
          {station.latitude.toFixed(4)}°, {station.longitude.toFixed(4)}°
        </p>
        <p className="merra2-panel-meta">
          {station.mode === 'latest' ? 'Reading time' : 'Data date'}:{' '}
          {formatDateMonthDayYear(displayDate)}
        </p>
        <p className="merra2-panel-meta">
          {station.isMonitor ? 'Reference monitor' : 'Air sensor'}
        </p>
      </div>

      <div className="aaqe-metrics-row">
        <div
          className="aaqe-metric-card"
          style={{ borderTop: `3px solid ${metricsLoading ? '#d1d5db' : aqiBgColor}` }}
        >
          <div
            className="aaqe-metric-value"
            style={{ color: metricsLoading ? '#9ca3af' : aqiTxtColor }}
          >
            {metricsLoading ? '…' : (aqi ?? '—')}
          </div>
          <div className="aaqe-metric-label">AQI</div>
          <div
            className="aaqe-metric-cat"
            style={{ color: metricsLoading ? '#9ca3af' : aqiTxtColor }}
          >
            {metricsLoading ? 'Updating…' : aqiCat.label}
          </div>
        </div>
        <div className="aaqe-metric-card">
          <div
            className="aaqe-metric-value"
            style={{ color: metricsLoading ? '#9ca3af' : '#1f2937' }}
          >
            {metricsLoading || !hasOpenAqPm25Value(station) ? '…' : station.pm25!.toFixed(1)}
          </div>
          <div className="aaqe-metric-label">PM2.5 (µg/m³)</div>
          <div className="aaqe-metric-cat" style={{ color: '#6b7280' }}>
            {statLabel}
          </div>
        </div>
      </div>

      {station.locality && (
        <div className="merra2-panel-address">
          <span className="aaqe-section-label" style={{ display: 'inline', marginBottom: 0 }}>
            Locality:{' '}
          </span>
          {station.locality}
        </div>
      )}

      <p className="data-source-footer">Source: OpenAQ v3 · explore.openaq.org</p>
    </div>
  );
}

export interface WashUSelectedPanelProps {
  lat: number;
  lon: number;
  periodLabel: string;
  pm25: number | null;
  loading?: boolean;
}

export function WashUSelectedPanel({
  lat,
  lon,
  periodLabel,
  pm25,
  loading,
}: WashUSelectedPanelProps) {
  const aqi = pm25 != null ? calculateAQIFromPm25(pm25) : null;
  const aqiCat = getAqiCategory(aqi);
  const aqiBgColor = aqiCat.color;
  const aqiTxtColor = getAqiTextColor(aqi);

  return (
    <div className="merra2-panel washu-panel">
      <div className="merra2-panel-header">
        <p className="merra2-panel-site">WashU SatPM2.5 location</p>
        <p className="merra2-panel-meta">V6.GL.03 · Africa fine resolution (~1 km)</p>
        <p className="merra2-panel-meta">
          {lat.toFixed(4)}°, {lon.toFixed(4)}°
        </p>
        <p className="merra2-panel-meta">Map period: {periodLabel}</p>
      </div>

      <div className="aaqe-metrics-row">
        <div
          className="aaqe-metric-card"
          style={{ borderTop: `3px solid ${loading ? '#d1d5db' : aqiBgColor}` }}
        >
          <div className="aaqe-metric-value" style={{ color: loading ? '#9ca3af' : aqiTxtColor }}>
            {loading ? '…' : (aqi ?? '—')}
          </div>
          <div className="aaqe-metric-label">AQI (from PM2.5)</div>
          <div className="aaqe-metric-cat" style={{ color: loading ? '#9ca3af' : aqiTxtColor }}>
            {loading ? 'Updating…' : aqiCat.label}
          </div>
        </div>
        <div className="aaqe-metric-card">
          <div className="aaqe-metric-value" style={{ color: loading ? '#9ca3af' : '#756bb1' }}>
            {loading ? '…' : (pm25 != null ? pm25.toFixed(1) : '—')}
          </div>
          <div className="aaqe-metric-label">PM2.5 (µg/m³)</div>
          <div className="aaqe-metric-cat" style={{ color: '#6b7280' }}>
            {loading ? 'Sampling…' : 'nearest grid cell'}
          </div>
        </div>
      </div>

      <p className="data-source-footer">
        Source: WashU ACAG SatPM2.5 ·{' '}
        <a href="https://sites.wustl.edu/acag/surface-pm2-5/" target="_blank" rel="noopener noreferrer">
          sites.wustl.edu/acag
        </a>
      </p>
    </div>
  );
}

export interface AeronetSelectedPanelProps {
  site: AERONETSite;
  chartData: AERONETDataPoint[];
  chartLoading: boolean;
  aeronetStart: string;
  aeronetEnd: string;
  onExportCsv?: () => void;
}

const AOD_WAVELENGTHS = [
  { label: '500 nm', key: 'AOD_500nm' as const },
  { label: '675 nm', key: 'AOD_675nm' as const },
  { label: '870 nm', key: 'AOD_870nm' as const },
  { label: '1020 nm', key: 'AOD_1020nm' as const },
];

export function AeronetSelectedPanel({
  site,
  chartData,
  chartLoading,
  aeronetStart,
  aeronetEnd,
  onExportCsv,
}: AeronetSelectedPanelProps) {
  const dailyMean = computeDailyMeanAOD(chartData);
  const latest = dailyMean.length > 0 ? dailyMean[dailyMean.length - 1] : chartData[chartData.length - 1];
  const avg = (arr: (number | undefined)[]) => {
    const v = arr.filter((x) => x != null && !Number.isNaN(x)) as number[];
    return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(2) : '—';
  };
  const fmt = (n: number | undefined) => (n != null && !Number.isNaN(n) ? n.toFixed(2) : '—');

  const dataRangeLabel =
    chartData.length > 0
      ? `${formatDateMonthDayYear(normalizeAeronetDate(chartData[0]?.date) ?? '')} – ${formatDateMonthDayYear(
          normalizeAeronetDate(chartData[chartData.length - 1]?.date) ?? ''
        )}`
      : null;

  return (
    <div className="aeronet-panel">
      <div className="merra2-panel-header">
        <p className="merra2-panel-site">{site.name ?? site.site}</p>
        <p className="merra2-panel-meta">
          AERONET AOD Station · {site.site}
          {site.elevation != null && ` · ${site.elevation.toFixed(0)} m`}
        </p>
        <p className="merra2-panel-meta">
          {(site.latitude ?? 0).toFixed(3)}°, {(site.longitude ?? 0).toFixed(3)}°
        </p>
        <p className="merra2-panel-meta">
          Requested range: {formatDateMonthDayYear(aeronetStart)} – {formatDateMonthDayYear(aeronetEnd)}
        </p>
      </div>

      {chartLoading ? (
        <p className="mini-note" style={{ padding: '2px 0 6px' }}>Loading AOD data…</p>
      ) : chartData.length === 0 ? (
        <p className="mini-note" style={{ padding: '2px 0 6px' }}>No AOD measurements in this date range.</p>
      ) : (
        <>
          <div className="aod-metrics-grid">
            {AOD_WAVELENGTHS.map(({ label, key }) => {
              const val = latest?.[key];
              const color = getAODLevelColor(val);
              const level = getAODLevelLabel(val);
              return (
                <div className="aod-metric-card" key={key} style={{ borderTop: `3px solid ${color}` }}>
                  <div className="aod-metric-value" style={{ color }}>{fmt(val)}</div>
                  <div className="aod-metric-label">AOD {label}</div>
                  <div className="aod-metric-level" style={{ color }}>{level || '—'}</div>
                  <div className="aod-metric-avg">avg {avg(dailyMean.map((d) => d[key]))}</div>
                </div>
              );
            })}
          </div>
          {dataRangeLabel && (
            <p className="mini-note" style={{ marginTop: 10 }}>
              {dataRangeLabel} · {chartData.length} measurements ({dailyMean.length} daily means)
            </p>
          )}
        </>
      )}

      {chartData.length > 0 && onExportCsv && (
        <>
          <button type="button" className="export-csv-btn" onClick={onExportCsv}>
            Export CSV
          </button>
          <p className="data-source-footer">AOD time series and wavelength charts below</p>
        </>
      )}
    </div>
  );
}

export interface FireSelectedPanelProps {
  fire: SelectedFireData;
}

/** Confidence strings from FIRMS are 'l'/'n'/'h' (low/nominal/high) or spelled out. */
function fireConfidenceColor(confidence: string): string {
  const c = confidence.trim().toLowerCase();
  if (c.startsWith('h')) return '#16a34a';
  if (c.startsWith('l')) return '#dc2626';
  return '#ca8a04';
}

export function FireSelectedPanel({ fire }: FireSelectedPanelProps) {
  const confidenceLabel = fire.confidence || 'nominal';
  const confColor = fireConfidenceColor(confidenceLabel);
  const daynightLabel = fire.daynight === 'D' ? 'Daytime' : fire.daynight === 'N' ? 'Nighttime' : fire.daynight || '—';

  return (
    <div className="fire-panel">
      <div className="merra2-panel-header">
        <p className="merra2-panel-site">Fire Hotspot Detection</p>
        <p className="merra2-panel-meta">VIIRS / NOAA-21 · 375 m · {fire.satellite} {fire.instrument}</p>
        <p className="merra2-panel-meta">
          {fire.latitude.toFixed(4)}°, {fire.longitude.toFixed(4)}°
        </p>
        <p className="merra2-panel-meta">
          {fire.acq_date} {fire.acq_time} UTC · {daynightLabel}
        </p>
      </div>

      <div className="aaqe-metrics-row">
        <div className="aaqe-metric-card" style={{ borderTop: '3px solid #ea580c' }}>
          <div className="aaqe-metric-value" style={{ color: '#ea580c' }}>
            {fire.frp != null ? fire.frp.toFixed(1) : '—'}
          </div>
          <div className="aaqe-metric-label">FRP (MW)</div>
          <div className="aaqe-metric-cat" style={{ color: '#6b7280' }}>Fire radiative power</div>
        </div>
        <div className="aaqe-metric-card" style={{ borderTop: `3px solid ${confColor}` }}>
          <div className="aaqe-metric-value" style={{ color: confColor, textTransform: 'capitalize' }}>
            {confidenceLabel}
          </div>
          <div className="aaqe-metric-label">Confidence</div>
          <div className="aaqe-metric-cat" style={{ color: '#6b7280' }}>Detection quality</div>
        </div>
      </div>

      <div className="fire-mini-stats">
        <div className="fire-mini-stat">
          <span>Brightness TI4</span>
          <strong>{fire.bright_ti4.toFixed(1)} K</strong>
        </div>
        <div className="fire-mini-stat">
          <span>Brightness TI5</span>
          <strong>{fire.bright_ti5 != null ? `${fire.bright_ti5.toFixed(1)} K` : '—'}</strong>
        </div>
        <div className="fire-mini-stat">
          <span>Scan / Track</span>
          <strong>{fire.scan} / {fire.track}</strong>
        </div>
        <div className="fire-mini-stat">
          <span>Version</span>
          <strong>{fire.version || '2.0NRT'}</strong>
        </div>
      </div>

      <p className="data-source-footer">Source: NASA FIRMS (VIIRS NOAA-21)</p>
    </div>
  );
}
