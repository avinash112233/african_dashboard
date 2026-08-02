import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import dayjs from 'dayjs';
import MapVisualization from '../components/maps/MapVisualization';
import { getNOAA21VIIRS7DayFromWFS, peekFirePoints, ensureFiresPrefetched, subscribeFirePoints, type FIRMSFirePoint } from '../services/firmsApi';
import {
  getAfricanAERONETSites,
  getAERONETData,
  getAERONETDataAfrica,
  type AERONETDataPoint,
  type SiteAODMap,
  type AERONETAODVersion,
} from '../services/aeronetApi';
import type { AERONETSite } from '../services/aeronetApi';
import ChartLoadingFallback from '../components/charts/ChartLoadingFallback';

const TimeSeriesChart = lazy(() => import('../components/charts/TimeSeriesChart'));
const ScatterPlotChart = lazy(() => import('../components/charts/ScatterPlotChart'));
const WavelengthBarChart = lazy(() => import('../components/charts/WavelengthBarChart'));
const FireCountTimeSeriesChart = lazy(() => import('../components/charts/FireCountTimeSeriesChart'));
const FireAverageFrpTimeSeriesChart = lazy(() => import('../components/charts/FireAverageFrpTimeSeriesChart'));
const FireBrightnessFrpScatterChart = lazy(() => import('../components/charts/FireBrightnessFrpScatterChart'));
const MERRA2StationTimeSeriesChart = lazy(() => import('../components/charts/MERRA2StationTimeSeriesChart'));
const OpenAqTimeSeriesChart = lazy(() => import('../components/charts/OpenAqTimeSeriesChart'));
const AAQEThreeDayForecastChart = lazy(() => import('../components/charts/AAQEThreeDayForecastChart'));
const WashUTimeSeriesChart = lazy(() => import('../components/charts/WashUTimeSeriesChart'));
const AnalysisPanel = lazy(() => import('../components/analysis/AnalysisPanel'));
import { fetchWashUTimeseries, getWashUStationsByDate, getWashUStationTimeseries, getWashULatestDate, loadWashUGrid, washuPeriodFromDate, washuStationTimeseriesBounds, defaultWashuStationSeriesRange, type WashUTimeseriesPoint, type WashUStationDailyRecord, type WashUStationTimeseriesPoint } from '../services/washuApi';
import { loadMerra2DailyCube } from '../services/merra2GridCube';
import { formatDateMonthDayYear, formatDisplayDate, normalizeAeronetDate } from '../utils/dateFormat';
import {
  merra2DefaultDate,
  MERRA2_DEFAULT_DATE,
  openAqHistoricalDefaultDate,
  todayDefaultDate,
} from '../utils/dashboardDates';
import { computeDailyMeanAOD, getAODLevelColor, getAODLevelLabel } from '../utils/aodUtils';
import { aggregateFiresByDate, getFireBrightness, normalizeFireDate } from '../utils/fireAnalytics';
import type { LatLonBounds } from '../utils/geoUtils';
import { distanceMeters, isPointInLatLonBounds } from '../utils/geoUtils';
import {
  getMERRA2LatestDate,
  getMERRA2StationsByDate,
  getMERRA2StationTimeseries,
  type MERRA2StationDailyRecord,
  type MERRA2StationTimeseriesPoint,
} from '../services/merra2Api';
import {
  getOpenAqArchiveInfo,
  getOpenAqLocations,
  getOpenAqStations,
  getOpenAqStationDay,
  getOpenAqTimeseries,
  hasOpenAqPm25Value,
  mergeOpenAqStationValues,
  peekOpenAqStations,
  prefetchOpenAqHistorical,
  prefetchOpenAqNrt,
  refreshOpenAqStationsInBackground,
  seedOpenAqTimeseriesFromStation,
  skeletonStationsFromLocations,
  type OpenAqMapMode,
  type OpenAqStationRecord,
  type OpenAqTimeseriesPoint,
} from '../services/openaqApi';
import {
  findNearestAAQEForecastInitDate,
  getAAQEForecastByDate,
  getAaqeDisplayValues,
  getAaqeForecastDaysAfterSelected,
  getDefaultAaqeTimeCodeFromUtc,
  type AAQEForecastPoint,
  type AaqeDisplayType,
} from '../services/aaqeForecastApi';
import { calculateAQIFromPm25, getAqiCategory } from '../utils/aqiUtils';
import {
  anchorFromAaqe,
  anchorFromAeronet,
  anchorFromFire,
  anchorFromMerra2,
} from '../analysis/locationAnchor';
import type { AnalysisLocationContext } from '../analysis/types';
import {
  DASHBOARD_V1_LAYER_LABELS,
  DASHBOARD_V1_WORKFLOW_META,
  DASHBOARD_V1_WORKFLOW_TABS,
  type DashboardV1Layer,
  type DashboardV1Workflow,
} from '../dashboardV1/config';
import './DashboardPage.css';

const COMPACT_LAYOUT_MAX_PX = 1023;

function useCompactLayout() {
  const [isCompact, setIsCompact] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(`(max-width: ${COMPACT_LAYOUT_MAX_PX}px)`).matches
  );

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${COMPACT_LAYOUT_MAX_PX}px)`);
    const onChange = (e: MediaQueryListEvent) => setIsCompact(e.matches);
    setIsCompact(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return isCompact;
}

interface SelectedFireData {
  latitude: number;
  longitude: number;
  bright_ti4: number;
  bright_ti5?: number;
  scan: number;
  track: number;
  acq_date: string;
  acq_time: string;
  satellite: string;
  instrument: string;
  confidence: string;
  version?: string;
  frp?: number;
  daynight: string;
}

interface SelectedAAQEData {
  latitude: number;
  longitude: number;
  station?: string;
  siteName?: string;
  utcDate?: string;
  dailyAqi?: number;
  selectedPm?: number;
  selectedTimeCode?: string;
  hourlyPm: Array<{ label: string; value: number }>;
  hourlyAqi: Array<{ label: string; value: number }>;
  selectedAqiCategory?: string;
}

function normalizeForecastDate(value: string | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  if (/^\d{8}$/.test(v)) return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
  return null;
}

function filterPointsByUtcDate(points: AAQEForecastPoint[], targetIso: string): AAQEForecastPoint[] {
  return points.filter(
    (p) => normalizeForecastDate(String(p.properties.UTC_DATE ?? '')) === targetIso
  );
}

// ── AAQE Selected Panel ───────────────────────────────────────────────────────
interface AaqeSelectedPanelProps {
  data: SelectedAAQEData;
  threeDayRows: Array<{ label: string; date: string; aqi: number }>;
}

function fmtHourCode(code: string): string {
  const p = code.padStart(4, '0');
  return `${p.slice(0, 2)}:${p.slice(2)} UTC`;
}

/** Readable text color for AQI value displayed on a white/light background. */
function getAqiTextColor(aqi: number | null): string {
  if (aqi == null || !Number.isFinite(aqi)) return '#6b7280';
  if (aqi <= 50)  return '#16a34a';  // Good — dark green
  if (aqi <= 100) return '#a16207';  // Moderate — dark amber (yellow → unreadable)
  if (aqi <= 150) return '#c2410c';  // Unhealthy for Sensitive — dark orange
  if (aqi <= 200) return '#b91c1c';  // Unhealthy — dark red
  if (aqi <= 300) return '#7e22ce';  // Very Unhealthy — dark purple
  return '#7f1d1d';                  // Hazardous — dark maroon
}

function openAqChartRangeEnd(
  calendarEnd: dayjs.Dayjs,
  lastReading: string | undefined,
  mode: OpenAqMapMode
) {
  if (!lastReading) return calendarEnd;
  const last = dayjs(lastReading, 'YYYY-MM-DD');
  if (mode === 'latest') {
    return last.isAfter(calendarEnd, 'day') ? last : calendarEnd;
  }
  return last.isBefore(calendarEnd, 'day') ? last : calendarEnd;
}

function AaqeSelectedPanel({ data, threeDayRows }: AaqeSelectedPanelProps) {
  const aqiCat      = getAqiCategory(data.dailyAqi ?? null);
  const aqiBgColor  = aqiCat.color;                          // original (may be bright)
  const aqiTxtColor = getAqiTextColor(data.dailyAqi ?? null); // always readable on white

  const aqiByCode = new Map(
    data.hourlyAqi.map((h) => {
      const m = h.label.match(/\((\d+)\)/);
      return [m?.[1] ?? h.label, h.value] as [string, number];
    })
  );

  return (
    <div className="aaqe-panel">
      {/* Location header */}
      <div className="aaqe-panel-header">
        <p className="aaqe-panel-site">{data.siteName ?? 'Unknown Site'}</p>
        <p className="aaqe-panel-meta">AAQE PM2.5 Forecast</p>
        {data.utcDate && (
          <p className="aaqe-panel-meta">Forecast date: {data.utcDate}</p>
        )}
        <p className="aaqe-panel-meta">
          {data.latitude.toFixed(4)}°, {data.longitude.toFixed(4)}°
        </p>
      </div>

      {/* Key metrics */}
      <div className="aaqe-metrics-row">
        <div className="aaqe-metric-card" style={{ borderTop: `3px solid ${aqiBgColor}` }}>
          <div className="aaqe-metric-value" style={{ color: aqiTxtColor }}>
            {data.dailyAqi ?? '—'}
          </div>
          <div className="aaqe-metric-label">Daily AQI</div>
          <div className="aaqe-metric-cat" style={{ color: aqiTxtColor }}>{aqiCat.label}</div>
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

      {/* Hourly table — one row per time slot, PM2.5 + AQI merged */}
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
                const m    = h.label.match(/\((\d+)\)/);
                const code = m?.[1] ?? '';
                const aqi  = aqiByCode.get(code);
                const cat  = getAqiCategory(aqi ?? null);
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
                      ) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      {/* 3-day outlook */}
      {threeDayRows.length > 0 && (
        <>
          <div className="aaqe-section-label">3-Day Outlook</div>
          <div className="aaqe-threeday-grid">
            {threeDayRows.map((r) => {
              const c    = getAqiCategory(r.aqi);
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
                  <div className="aaqe-threeday-cat" style={{ color: txtC }}>{c.label}</div>
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


interface Merra2SelectedPanelProps {
  station: import('../services/merra2Api').MERRA2StationDailyRecord;
  aqi: number | null;
  dataDate: string;
  metricsLoading?: boolean;
}

function Merra2SelectedPanel({ station, aqi, dataDate, metricsLoading }: Merra2SelectedPanelProps) {
  const aqiCat      = getAqiCategory(aqi);
  const aqiBgColor  = aqiCat.color;
  const aqiTxtColor = getAqiTextColor(aqi);

  return (
    <div className="merra2-panel">
      <div className="merra2-panel-header">
        <p className="merra2-panel-site">{station.sitename}</p>
        <p className="merra2-panel-meta">MERRA2 CNN PM2.5 Station</p>
        {station.country && (
          <p className="merra2-panel-meta">{station.country}</p>
        )}
        <p className="merra2-panel-meta">
          {station.latitude.toFixed(4)}°, {station.longitude.toFixed(4)}°
        </p>
        <p className="merra2-panel-meta">Data date: {formatDateMonthDayYear(dataDate)}</p>
      </div>

      <div className="aaqe-metrics-row">
        <div className="aaqe-metric-card" style={{ borderTop: `3px solid ${metricsLoading ? '#d1d5db' : aqiBgColor}` }}>
          <div className="aaqe-metric-value" style={{ color: metricsLoading ? '#9ca3af' : aqiTxtColor }}>
            {metricsLoading ? '…' : (aqi ?? '—')}
          </div>
          <div className="aaqe-metric-label">AQI</div>
          <div className="aaqe-metric-cat" style={{ color: metricsLoading ? '#9ca3af' : aqiTxtColor }}>
            {metricsLoading ? 'Updating…' : aqiCat.label}
          </div>
        </div>
        <div className="aaqe-metric-card">
          <div className="aaqe-metric-value" style={{ color: metricsLoading ? '#9ca3af' : '#1f2937' }}>
            {metricsLoading ? '…' : station.pm25.toFixed(1)}
          </div>
          <div className="aaqe-metric-label">PM2.5 (µg/m³)</div>
          <div className="aaqe-metric-cat" style={{ color: '#6b7280' }}>daily average</div>
        </div>
      </div>

      {station.fullAddress && (
        <div className="merra2-panel-address">
          <span className="aaqe-section-label" style={{ display: 'inline', marginBottom: 0 }}>Location: </span>
          {station.fullAddress}
        </div>
      )}

      <p className="data-source-footer">Source: MERRA2 parquet station archive</p>
    </div>
  );
}

interface WashuStationSelectedPanelProps {
  station: WashUStationDailyRecord;
  aqi: number | null;
  dataDate: string;
  metricsLoading?: boolean;
}

function WashuStationSelectedPanel({ station, aqi, dataDate, metricsLoading }: WashuStationSelectedPanelProps) {
  const aqiCat = getAqiCategory(aqi);
  const aqiBgColor = aqiCat.color;
  const aqiTxtColor = getAqiTextColor(aqi);

  return (
    <div className="merra2-panel washu-panel">
      <div className="merra2-panel-header">
        <p className="merra2-panel-site">{station.sitename}</p>
        <p className="merra2-panel-meta">WashU ACAG SatPM2.5 Station</p>
        {station.country && <p className="merra2-panel-meta">{station.country}</p>}
        <p className="merra2-panel-meta">
          {station.latitude.toFixed(4)}°, {station.longitude.toFixed(4)}°
        </p>
        <p className="merra2-panel-meta">
          Data period: {station.periodLabel ?? station.period ?? formatDateMonthDayYear(dataDate)} (monthly mean)
        </p>
      </div>

      <div className="aaqe-metrics-row">
        <div className="aaqe-metric-card" style={{ borderTop: `3px solid ${metricsLoading ? '#d1d5db' : aqiBgColor}` }}>
          <div className="aaqe-metric-value" style={{ color: metricsLoading ? '#9ca3af' : aqiTxtColor }}>
            {metricsLoading ? '…' : (aqi ?? '—')}
          </div>
          <div className="aaqe-metric-label">AQI</div>
          <div className="aaqe-metric-cat" style={{ color: metricsLoading ? '#9ca3af' : aqiTxtColor }}>
            {metricsLoading ? 'Updating…' : aqiCat.label}
          </div>
        </div>
        <div className="aaqe-metric-card">
          <div className="aaqe-metric-value" style={{ color: metricsLoading ? '#9ca3af' : '#1f2937' }}>
            {metricsLoading ? '…' : station.pm25.toFixed(1)}
          </div>
          <div className="aaqe-metric-label">PM2.5 (µg/m³)</div>
          <div className="aaqe-metric-cat" style={{ color: '#6b7280' }}>monthly mean</div>
        </div>
      </div>

      {station.fullAddress && (
        <div className="merra2-panel-address">
          <span className="aaqe-section-label" style={{ display: 'inline', marginBottom: 0 }}>Location: </span>
          {station.fullAddress}
        </div>
      )}

      <p className="data-source-footer">Source: WashU ACAG station parquet archive</p>
    </div>
  );
}

interface OpenAqSelectedPanelProps {
  station: OpenAqStationRecord;
  aqi: number | null;
  dataDate: string;
  metricsLoading?: boolean;
}

function OpenAqSelectedPanel({ station, aqi, dataDate, metricsLoading }: OpenAqSelectedPanelProps) {
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
          {station.mode === 'latest' ? 'Reading time' : 'Data date'}: {formatDateMonthDayYear(displayDate)}
        </p>
        <p className="merra2-panel-meta">
          {station.isMonitor ? 'Reference monitor' : 'Air sensor'}
        </p>
      </div>

      <div className="aaqe-metrics-row">
        <div className="aaqe-metric-card" style={{ borderTop: `3px solid ${metricsLoading ? '#d1d5db' : aqiBgColor}` }}>
          <div className="aaqe-metric-value" style={{ color: metricsLoading ? '#9ca3af' : aqiTxtColor }}>
            {metricsLoading ? '…' : (aqi ?? '—')}
          </div>
          <div className="aaqe-metric-label">AQI</div>
          <div className="aaqe-metric-cat" style={{ color: metricsLoading ? '#9ca3af' : aqiTxtColor }}>
            {metricsLoading ? 'Updating…' : aqiCat.label}
          </div>
        </div>
        <div className="aaqe-metric-card">
          <div className="aaqe-metric-value" style={{ color: metricsLoading ? '#9ca3af' : '#1f2937' }}>
            {metricsLoading
              ? '…'
              : !hasOpenAqPm25Value(station)
                ? '—'
                : station.pm25!.toFixed(1)}
          </div>
          <div className="aaqe-metric-label">PM2.5 (µg/m³)</div>
          <div className="aaqe-metric-cat" style={{ color: '#6b7280' }}>{statLabel}</div>
        </div>
      </div>

      {station.locality && (
        <div className="merra2-panel-address">
          <span className="aaqe-section-label" style={{ display: 'inline', marginBottom: 0 }}>Locality: </span>
          {station.locality}
        </div>
      )}

      <p className="data-source-footer">Source: OpenAQ v3 · explore.openaq.org</p>
    </div>
  );
}

function WashUSelectedPanel({
  lat,
  lon,
  periodLabel,
  pm25,
  loading,
}: {
  lat: number;
  lon: number;
  periodLabel: string;
  pm25: number | null;
  loading?: boolean;
}) {
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
        <div className="aaqe-metric-card" style={{ borderTop: `3px solid ${loading ? '#d1d5db' : aqiBgColor}` }}>
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

const DashboardPage = () => {
  const [selectedDate, setSelectedDate] = useState(() => todayDefaultDate());
  const [selectedFire, setSelectedFire] = useState<SelectedFireData | null>(null);
  const [firePoints, setFirePoints] = useState<FIRMSFirePoint[]>(() => peekFirePoints() ?? []);
  const [aeronetSites, setAeronetSites] = useState<AERONETSite[]>([]);
  type LayerMode = DashboardV1Layer;
  const [workflow, setWorkflow] = useState<DashboardV1Workflow>('historical');
  const [activeLayers, setActiveLayers] = useState<LayerMode[]>(['aeronet']);
  const [, setPrimaryLayer] = useState<LayerMode>('aeronet');
  const layerOn = useCallback((layer: LayerMode) => activeLayers.includes(layer), [activeLayers]);
  const showAeronet = layerOn('aeronet');
  const showFires = layerOn('fires');
  const showVIIRSImagery = layerOn('viirs');
  const showMERRA2PM25 = layerOn('merra2');
  const showWashU = layerOn('washu');
  const showOpenAq = layerOn('openaq');
  const showAAQEForecast = layerOn('aaqe');
  const preloadHistoricalLayers = workflow === 'historical';
  const preloadNrtLayers = workflow === 'nrt';
  const preloadForecastLayers = workflow === 'forecast';
  const preloadOpenAqLayers = preloadHistoricalLayers || preloadNrtLayers;
  const [aaqeForecastPoints, setAaqeForecastPoints] = useState<AAQEForecastPoint[]>([]);
  const [aaqeLoading, setAaqeLoading] = useState(false);
  const [aaqeError, setAaqeError] = useState<string | null>(null);
  const [aaqeNotice, setAaqeNotice] = useState<string | null>(null);
  const [selectedAAQE, setSelectedAAQE] = useState<SelectedAAQEData | null>(null);
  const [aaqeForecastByDate, setAaqeForecastByDate] = useState<Record<string, AAQEForecastPoint[]>>({});
  const [aaqeInitDate, setAaqeInitDate] = useState<string | null>(null);
  const [aaqeForecastDayIndex, setAaqeForecastDayIndex] = useState(1);
  const [aaqeForecastDate, setAaqeForecastDate] = useState<string | null>(null);
  const [aaqeDisplayType, setAaqeDisplayType] = useState<AaqeDisplayType>('DAILY_AQI');
  const [aaqeTimeCode, setAaqeTimeCode] = useState('1330');
  const [selectedMerra2Station, setSelectedMerra2Station] = useState<MERRA2StationDailyRecord | null>(null);
  const [merra2Stations, setMerra2Stations] = useState<MERRA2StationDailyRecord[]>([]);
  const [merra2Series, setMerra2Series] = useState<MERRA2StationTimeseriesPoint[]>([]);
  const [merra2SeriesLoading, setMerra2SeriesLoading] = useState(false);
  const [merra2Error, setMerra2Error] = useState<string | null>(null);
  const [merra2Notice, setMerra2Notice] = useState<string | null>(null);
  const [merra2DataDate, setMerra2DataDate] = useState<string | null>(null);
  const [merra2LatestDate, setMerra2LatestDate] = useState<string | null>(null);
  const [merra2DateFrom, setMerra2DateFrom] = useState(() => dayjs().subtract(6, 'day'));
  const [merra2DateTo, setMerra2DateTo] = useState(() => dayjs());
  const [merra2AppliedRange, setMerra2AppliedRange] = useState(() => ({
    start: dayjs().subtract(6, 'day').format('YYYY-MM-DD'),
    end: dayjs().format('YYYY-MM-DD'),
  }));
  const [circleSelectActive, setCircleSelectActive] = useState(false);
  const [circleCenter, setCircleCenter] = useState<[number, number] | null>(null);
  const [circleRadiusKm] = useState(5);
  const [fireChartRectDrawActive, setFireChartRectDrawActive] = useState(false);
  const [fireChartBounds, setFireChartBounds] = useState<LatLonBounds | null>(null);
  const [fireLoading, setFireLoading] = useState(false);
  const [merra2Loading, setMerra2Loading] = useState(false);
  const [merra2ShowStations, setMerra2ShowStations] = useState(true);
  const [merra2ShowGridOverlay, setMerra2ShowGridOverlay] = useState(false);
  const [merra2GridLoading, setMerra2GridLoading] = useState(false);
  const [merra2GridHour, setMerra2GridHour] = useState(12);
  const [merra2GridSource, setMerra2GridSource] = useState<'gesdisc' | 'sample' | null>(null);
  const [merra2GridFallbackReason, setMerra2GridFallbackReason] = useState<string | null>(null);
  const [washuPeriod, setWashuPeriod] = useState<'monthly' | 'annual'>('monthly');
  const [washuShowStations, setWashuShowStations] = useState(true);
  const [washuShowGridOverlay, setWashuShowGridOverlay] = useState(true);
  const [washuGridLoading, setWashuGridLoading] = useState(false);
  const [washuStationsLoading, setWashuStationsLoading] = useState(false);
  const [washuStationsError, setWashuStationsError] = useState<string | null>(null);
  const [washuStationsNotice, setWashuStationsNotice] = useState<string | null>(null);
  const [washuDataDate, setWashuDataDate] = useState<string | null>(null);
  const [washuLatestDate, setWashuLatestDate] = useState<string | null>(null);
  const [washuStations, setWashuStations] = useState<WashUStationDailyRecord[]>([]);
  const [selectedWashuStation, setSelectedWashuStation] = useState<WashUStationDailyRecord | null>(null);
  const [washuStationSeries, setWashuStationSeries] = useState<WashUStationTimeseriesPoint[]>([]);
  const [washuStationSeriesLoading, setWashuStationSeriesLoading] = useState(false);
  const [washuStationSeriesGranularity, setWashuStationSeriesGranularity] = useState<'monthly' | 'annual'>('monthly');
  const [washuStationSeriesStartYear, setWashuStationSeriesStartYear] = useState(2018);
  const [washuStationSeriesStartMonth, setWashuStationSeriesStartMonth] = useState(1);
  const [washuStationSeriesEndYear, setWashuStationSeriesEndYear] = useState(2023);
  const [washuStationSeriesEndMonth, setWashuStationSeriesEndMonth] = useState(12);
  const [washuStationAppliedSeriesRange, setWashuStationAppliedSeriesRange] = useState({
    startYear: 2018,
    startMonth: 1,
    endYear: 2023,
    endMonth: 12,
    granularity: 'monthly' as 'monthly' | 'annual',
  });
  const [washuGridSource, setWashuGridSource] = useState<'satpm' | 'sample' | null>(null);
  const [washuGridFallbackReason, setWashuGridFallbackReason] = useState<string | null>(null);
  const [washuPin, setWashuPin] = useState<{ lat: number; lon: number; pm25: number | null } | null>(null);
  const [washuSeries, setWashuSeries] = useState<WashUTimeseriesPoint[]>([]);
  const [washuSeriesLoading, setWashuSeriesLoading] = useState(false);
  const [washuSeriesError, setWashuSeriesError] = useState<string | null>(null);
  const [washuSeriesStartYear, setWashuSeriesStartYear] = useState(() => dayjs('2023-01-01').year());
  const [washuSeriesStartMonth, setWashuSeriesStartMonth] = useState(1);
  const [washuSeriesEndYear, setWashuSeriesEndYear] = useState(() => dayjs('2023-12-01').year());
  const [washuSeriesEndMonth, setWashuSeriesEndMonth] = useState(12);
  const [washuAppliedSeriesRange, setWashuAppliedSeriesRange] = useState({
    startYear: 2023,
    startMonth: 1,
    endYear: 2023,
    endMonth: 12,
  });
  const [openAqStations, setOpenAqStations] = useState<OpenAqStationRecord[]>([]);
  const [openAqLoading, setOpenAqLoading] = useState(false);
  const [openAqError, setOpenAqError] = useState<string | null>(null);
  const [openAqMapMode, setOpenAqMapMode] = useState<OpenAqMapMode>('daily');
  const [openAqArchiveCutoffDate, setOpenAqArchiveCutoffDate] = useState<string | null>(null);
  const [openAqMonitorsOnly, setOpenAqMonitorsOnly] = useState(false);
  const [selectedOpenAqStation, setSelectedOpenAqStation] = useState<OpenAqStationRecord | null>(null);
  const [openAqSeries, setOpenAqSeries] = useState<OpenAqTimeseriesPoint[]>([]);
  const [openAqSeriesLoading, setOpenAqSeriesLoading] = useState(false);
  const [openAqSeriesError, setOpenAqSeriesError] = useState<string | null>(null);
  const [openAqDateFrom, setOpenAqDateFrom] = useState(() => dayjs().subtract(6, 'day'));
  const [openAqDateTo, setOpenAqDateTo] = useState(() => dayjs());
  const [openAqAppliedRange, setOpenAqAppliedRange] = useState(() => ({
    start: dayjs().subtract(6, 'day').format('YYYY-MM-DD'),
    end: dayjs().format('YYYY-MM-DD'),
  }));
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarPeek, setSidebarPeek] = useState(false);
  const [aeronetLoading, setAeronetLoading] = useState(false);
  const [aeronetError, setAeronetError] = useState<string | null>(null);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const isCompactLayout = useCompactLayout();
  const [leftPanelOpen, setLeftPanelOpen] = useState(false);
  const [selectedSite, setSelectedSite] = useState<AERONETSite | null>(null);
  const [analysisAnchor, setAnalysisAnchor] = useState<AnalysisLocationContext | null>(null);

  useEffect(() => {
    void import('../components/analysis/AnalysisPanel');
  }, []);
  const [chartData, setChartData] = useState<AERONETDataPoint[]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [siteAodMap, setSiteAodMap] = useState<SiteAODMap>({});
  const [aeronetDateFrom, setAeronetDateFrom] = useState(() => dayjs().subtract(7, 'day'));
  const [aeronetDateTo, setAeronetDateTo] = useState(() => dayjs());
  const [aeronetAodVersion, setAeronetAodVersion] = useState<AERONETAODVersion>(1.5);

  type AnalysisRange = '7D' | '30D' | '90D';
  const [analysisRange, setAnalysisRange] = useState<AnalysisRange>('7D');
  type FireAnalysisRange = '24H' | '48H' | '7D';
  const [fireAnalysisRange, setFireAnalysisRange] = useState<FireAnalysisRange>('7D');

  const getDateRange = (selectedDateStr: string, range: AnalysisRange): { startDate: string; endDate: string } => {
    // Cap end date at today so we never request data for future dates.
    const today = dayjs().startOf('day');
    const requested = dayjs(selectedDateStr, 'YYYY-MM-DD').startOf('day');
    const end = requested.isAfter(today) ? today : requested;
    const days = range === '7D' ? 7 : range === '30D' ? 30 : 90;
    const start = end.subtract(days - 1, 'day');
    return { startDate: start.format('YYYY-MM-DD'), endDate: end.format('YYYY-MM-DD') };
  };

  const effectiveSelectedDate = selectedDate.isAfter(dayjs(), 'day') ? dayjs() : selectedDate;
  const effectiveSelectedDateStr = effectiveSelectedDate.format('YYYY-MM-DD');
  const merra2RequestedDate = useMemo(() => {
    if (!merra2LatestDate) return effectiveSelectedDateStr;
    const maxSupported = dayjs(merra2LatestDate, 'YYYY-MM-DD');
    return effectiveSelectedDate.isAfter(maxSupported, 'day')
      ? merra2LatestDate
      : effectiveSelectedDateStr;
  }, [effectiveSelectedDate, effectiveSelectedDateStr, merra2LatestDate]);
  const { startDate: analysisStartDate, endDate: analysisEndDate } = getDateRange(effectiveSelectedDateStr, analysisRange);
  const merra2AnalysisStartDate = merra2AppliedRange.start;
  const merra2AnalysisEndDate = merra2AppliedRange.end;
  const washuMapDate = useMemo(() => {
    const maxSupported = dayjs(MERRA2_DEFAULT_DATE, 'YYYY-MM-DD');
    return effectiveSelectedDate.isAfter(maxSupported, 'day') ? maxSupported : effectiveSelectedDate;
  }, [effectiveSelectedDate]);
  const washuPeriodParts = useMemo(() => washuPeriodFromDate(washuMapDate.format('YYYY-MM-DD')), [washuMapDate]);
  const washuRequestedDate = washuMapDate.format('YYYY-MM-DD');
  const washuPeriodLabel =
    washuPeriod === 'annual'
      ? String(washuPeriodParts.year)
      : `${washuPeriodParts.year}-${String(washuPeriodParts.month).padStart(2, '0')}`;
  const analysisRangeLabel =
    analysisRange === '7D' ? 'Last 7 Days' : analysisRange === '30D' ? 'Last 30 Days' : 'Last 90 Days';

  const getFireDateTime = useCallback((acqDate?: string, acqTime?: string) => {
    const normalized = normalizeFireDate(acqDate);
    if (!normalized) return null;
    const rawTime = (acqTime ?? '').replace(/\D/g, '');
    const hhmm = rawTime ? rawTime.padStart(4, '0').slice(-4) : '0000';
    const hour = Number(hhmm.slice(0, 2));
    const minute = Number(hhmm.slice(2, 4));
    if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) {
      return dayjs(`${normalized}T00:00:00`);
    }
    return dayjs(
      `${normalized}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`
    );
  }, []);

  const fireRangeHours = fireAnalysisRange === '24H' ? 24 : fireAnalysisRange === '48H' ? 48 : 7 * 24;
  type PreparedFirePoint = { fire: FIRMSFirePoint; dateTime: dayjs.Dayjs };
  const preparedFirePoints = useMemo<PreparedFirePoint[]>(() => {
    if (!showFires || firePoints.length === 0) return [];
    const prepared: PreparedFirePoint[] = [];
    for (const fire of firePoints) {
      const dt = getFireDateTime(fire.acq_date, fire.acq_time);
      if (!dt || !dt.isValid()) continue;
      prepared.push({ fire, dateTime: dt });
    }
    return prepared;
  }, [showFires, firePoints, getFireDateTime]);

  const latestFireDateTime = useMemo(() => {
    let latest: dayjs.Dayjs | null = null;
    for (const p of preparedFirePoints) {
      if (!latest || p.dateTime.isAfter(latest)) latest = p.dateTime;
    }
    return latest;
  }, [preparedFirePoints]);

  // Anchor the analysis window to the freshest FIRMS timestamp, not the date picker,
  // to prevent empty 24h/48h charts when the selected date is newer than the feed.
  const fireRangeEnd = useMemo(
    () => (latestFireDateTime ? latestFireDateTime.endOf('minute') : dayjs(effectiveSelectedDateStr).endOf('day')),
    [latestFireDateTime, effectiveSelectedDateStr]
  );
  const fireRangeStart = useMemo(() => fireRangeEnd.subtract(fireRangeHours, 'hour'), [fireRangeEnd, fireRangeHours]);
  const fireRangeLabel =
    fireAnalysisRange === '24H' ? 'Last 24 Hours' : fireAnalysisRange === '48H' ? 'Last 48 Hours' : 'Last 7 Days';

  const firesAfterSpatialFilter = useMemo(() => {
    if (!fireChartBounds) return preparedFirePoints;
    return preparedFirePoints.filter((p) =>
      isPointInLatLonBounds(p.fire.latitude, p.fire.longitude, fireChartBounds)
    );
  }, [preparedFirePoints, fireChartBounds]);

  const firesInAnalysisRange = useMemo(() => {
    return firesAfterSpatialFilter.filter((f) => {
      const d = f.dateTime;
      return (d.isAfter(fireRangeStart) || d.isSame(fireRangeStart)) && (d.isBefore(fireRangeEnd) || d.isSame(fireRangeEnd));
    });
  }, [firesAfterSpatialFilter, fireRangeStart, fireRangeEnd]);

  const fireDailyStats = useMemo(
    () => aggregateFiresByDate(firesInAnalysisRange.map((p) => p.fire)),
    [firesInAnalysisRange]
  );

  const fireScatterPoints = useMemo(() => {
    if (!showFires) return [];
    const points: { x: number; y: number; confidence?: string }[] = [];
    for (const item of firesInAnalysisRange) {
      const f = item.fire;
      const brightness = getFireBrightness(f);
      const frp = f.frp;
      if (brightness == null || frp == null || !Number.isFinite(frp)) continue;
      points.push({ x: brightness, y: frp, confidence: f.confidence });
    }
    return points;
  }, [showFires, firesInAnalysisRange]);

  // Sync AERONET date range to the selected date (rolling 7-day window).
  useEffect(() => {
    setAeronetDateTo(selectedDate);
    setAeronetDateFrom(selectedDate.subtract(7, 'day'));
  }, [selectedDate]);

  // Warm fire cache on dashboard open; subscribe so in-flight App-level prefetch updates state too.
  useEffect(() => {
    let cancelled = false;
    const apply = (pts: FIRMSFirePoint[]) => {
      if (!cancelled && pts.length > 0) setFirePoints(pts);
    };
    const unsub = subscribeFirePoints(apply);
    void ensureFiresPrefetched().then(apply).catch(() => {});
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  // Spinner only when the fires layer is visible and we still have no points.
  useEffect(() => {
    if (!showFires) {
      setFireLoading(false);
      return;
    }
    if (firePoints.length > 0) {
      setFireLoading(false);
      return;
    }
    let cancelled = false;
    setFireLoading(true);
    getNOAA21VIIRS7DayFromWFS()
      .then((pts) => {
        if (!cancelled && pts.length > 0) setFirePoints(pts);
      })
      .finally(() => {
        if (!cancelled) setFireLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showFires, firePoints.length]);

  useEffect(() => {
    setAaqeTimeCode(getDefaultAaqeTimeCodeFromUtc());
  }, []);

  // AAQE forecast: load for the whole Forecast workflow on open.
  useEffect(() => {
    if (!preloadForecastLayers) return;

    const requested = selectedDate.isAfter(dayjs(), 'day')
      ? dayjs().format('YYYY-MM-DD')
      : selectedDate.format('YYYY-MM-DD');

    let cancelled = false;
    setAaqeLoading(true);
    setAaqeError(null);
    setAaqeNotice(null);

    (async () => {
      const nearest = await findNearestAAQEForecastInitDate(requested);
      if (cancelled) return;
      if (!nearest) {
        setAaqeForecastByDate({});
        setAaqeForecastPoints([]);
        setAaqeInitDate(null);
        setAaqeForecastDate(null);
        setSelectedAAQE(null);
        setAaqeError('No AAQE forecast file found within the last 30 days.');
        setAaqeLoading(false);
        return;
      }
      const initDate = nearest.initDate;
      const forecastDays = getAaqeForecastDaysAfterSelected(requested);
      if (nearest.wasAdjusted) {
        setAaqeNotice(
          `No file for ${formatDateMonthDayYear(requested)}; using latest available run (${formatDateMonthDayYear(initDate)}).`
        );
      }
      const initPlus1 = dayjs(initDate).add(1, 'day').format('YYYY-MM-DD');
      const initPlus2 = dayjs(initDate).add(2, 'day').format('YYYY-MM-DD');
      try {
        const [rawInit, rawInitPlus1, rawInitPlus2] = await Promise.all([
          getAAQEForecastByDate(initDate),
          getAAQEForecastByDate(initPlus1).catch(() => []),
          getAAQEForecastByDate(initPlus2).catch(() => []),
        ]);
        if (cancelled) return;
        const pools = [rawInit, rawInitPlus1, rawInitPlus2];
        const byDateFinal: Record<string, AAQEForecastPoint[]> = {};
        for (const { iso } of forecastDays) {
          let pts: AAQEForecastPoint[] = [];
          for (const pool of pools) {
            const hit = filterPointsByUtcDate(pool, iso);
            if (hit.length > 0) {
              pts = hit;
              break;
            }
          }
          byDateFinal[iso] = pts;
        }
        const defaultDay = forecastDays[1] ?? forecastDays[0];
        setAaqeInitDate(initDate);
        setAaqeForecastDayIndex(defaultDay.dayIndex);
        setAaqeForecastByDate(byDateFinal);
        setAaqeForecastDate(defaultDay.iso);
        setAaqeForecastPoints(byDateFinal[defaultDay.iso] ?? []);
        setAaqeError(null);
      } catch (err: unknown) {
        if (cancelled) return;
        setAaqeForecastByDate({});
        setAaqeForecastPoints([]);
        setAaqeInitDate(null);
        setAaqeForecastDate(null);
        setSelectedAAQE(null);
        setAaqeError(
          err instanceof Error ? err.message : 'Failed to load AAQE PM2.5 forecast layer.'
        );
      } finally {
        if (!cancelled) setAaqeLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedDate, preloadForecastLayers]);

  useEffect(() => {
    if (!aaqeForecastDate) return;
    setAaqeForecastPoints(aaqeForecastByDate[aaqeForecastDate] ?? []);
  }, [aaqeForecastDate, aaqeForecastByDate]);

  const aeronetStart = aeronetDateFrom.isAfter(aeronetDateTo) ? aeronetDateTo : aeronetDateFrom;
  const aeronetEnd = aeronetDateFrom.isAfter(aeronetDateTo) ? aeronetDateFrom : aeronetDateTo;

  useEffect(() => {
    if (selectedSite) {
      const querySite = selectedSite.name && selectedSite.name !== selectedSite.site ? selectedSite.name : selectedSite.site;
      if (!querySite || typeof querySite !== 'string') return;
      setChartLoading(true);
      const start = analysisStartDate;
      const end = analysisEndDate;
      getAERONETData(querySite, start, end, aeronetAodVersion)
        .then((data) => setChartData(Array.isArray(data) ? data : []))
        .catch(() => setChartData([]))
        .finally(() => setChartLoading(false));
    }
  }, [analysisStartDate, analysisEndDate, selectedSite?.site, selectedSite?.name, aeronetAodVersion]);

  // Debounced AERONET AOD colors — preload for Historical workflow.
  useEffect(() => {
    if (!preloadHistoricalLayers) return;

    const day = aeronetEnd.format('YYYY-MM-DD');
    let cancelled = false;
    const t = window.setTimeout(() => {
      getAERONETDataAfrica(day, day, aeronetAodVersion)
        .then((map) => {
          if (!cancelled) setSiteAodMap(map);
        })
        .catch(() => {
          if (!cancelled) setSiteAodMap({});
        });
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [preloadHistoricalLayers, aeronetEnd, aeronetAodVersion]);

  const handleMerra2StationClick = useCallback((station: MERRA2StationDailyRecord) => {
    setSelectedMerra2Station(station);
    setSelectedSite(null);
    setSelectedFire(null);
    setSelectedAAQE(null);
    setSelectedOpenAqStation(null);
    setSelectedWashuStation(null);
    setWashuPin(null);
    setAnalysisAnchor(anchorFromMerra2(station));
    setChartData([]);
    setLeftPanelOpen(false);
    setRightPanelOpen(true);
  }, []);

  const handleWashuStationClick = useCallback((station: WashUStationDailyRecord) => {
    setSelectedWashuStation(station);
    setSelectedSite(null);
    setSelectedFire(null);
    setSelectedAAQE(null);
    setSelectedOpenAqStation(null);
    setSelectedMerra2Station(null);
    setWashuPin(null);
    setAnalysisAnchor(anchorFromMerra2(station));
    setChartData([]);
    setLeftPanelOpen(false);
    setRightPanelOpen(true);
  }, []);

  const handleOpenAqStationClick = useCallback((station: OpenAqStationRecord) => {
    setSelectedOpenAqStation(station);
    setSelectedSite(null);
    setSelectedFire(null);
    setSelectedAAQE(null);
    setSelectedMerra2Station(null);
    setChartData([]);
    setLeftPanelOpen(false);
    setRightPanelOpen(true);

    if (openAqMapMode === 'daily' && !hasOpenAqPm25Value(station)) {
      getOpenAqStationDay(station.sensorId, effectiveSelectedDateStr)
        .then((enriched) => {
          if (!hasOpenAqPm25Value(enriched)) return;
          setOpenAqStations((prev) =>
            prev.map((s) => (s.sensorId === enriched.sensorId ? enriched : s))
          );
          setSelectedOpenAqStation((prev) =>
            prev?.sensorId === enriched.sensorId ? enriched : prev
          );
        })
        .catch(() => {});
    }
  }, [effectiveSelectedDateStr, openAqMapMode]);

  // AERONET site list: load once on mount; cached in localStorage after that.
  useEffect(() => {
    if (aeronetSites.length > 0) return;
    let cancelled = false;
    setAeronetLoading(true);
    setAeronetError(null);
    getAfricanAERONETSites()
      .then((data) => {
        if (!cancelled) setAeronetSites(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setAeronetError(
            err?.message ||
              'Failed to fetch AERONET sites: AERONET API error (500 Internal Server Error): No error details'
          );
        }
      })
      .finally(() => {
        if (!cancelled) setAeronetLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [aeronetSites.length]);

  // Latest Parquet date — drives date cap and default when opening MERRA2 layer.
  useEffect(() => {
    let cancelled = false;
    getMERRA2LatestDate()
      .then((latest) => {
        if (!cancelled && latest.latestDate) setMerra2LatestDate(latest.latestDate);
      })
      .catch(() => {
        // Non-fatal; stations fallback will retry latest-date on missing data.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Prefetch OpenAQ historical archive date + stations as soon as the dashboard opens
  // so switching to the OpenAQ layer can render from cache.
  useEffect(() => {
    let cancelled = false;
    getOpenAqArchiveInfo()
      .then((info) => {
        if (!cancelled && info.cutoffDate) setOpenAqArchiveCutoffDate(info.cutoffDate);
      })
      .catch(() => {});
    prefetchOpenAqHistorical(false).then((date) => {
      if (!cancelled && date) setOpenAqArchiveCutoffDate(date);
    });
    void prefetchOpenAqNrt(false);
    return () => {
      cancelled = true;
    };
  }, []);

  // When archive cutoff arrives while Historical OpenAQ is active, snap only from
  // provisional defaults (today / yesterday / MERRA2 default) or dates after the cutoff.
  // Do not override intentional older dates the user already picked (e.g. 2021).
  useEffect(() => {
    if (!openAqArchiveCutoffDate || workflow !== 'historical' || !layerOn('openaq')) return;
    const target = openAqHistoricalDefaultDate(openAqArchiveCutoffDate);
    setSelectedDate((prev) => {
      if (prev.isSame(target, 'day')) return prev;
      if (prev.isAfter(target, 'day')) return target;
      const provisional =
        prev.isSame(dayjs(), 'day')
        || prev.isSame(dayjs().subtract(1, 'day'), 'day')
        || prev.format('YYYY-MM-DD') === MERRA2_DEFAULT_DATE;
      return provisional ? target : prev;
    });
  }, [openAqArchiveCutoffDate, workflow, layerOn]);

  useEffect(() => {
    if (!merra2LatestDate || workflow !== 'historical' || !layerOn('merra2')) return;
    setSelectedDate(merra2DefaultDate(merra2LatestDate));
  }, [merra2LatestDate]);

  useEffect(() => {
    if (!preloadHistoricalLayers) return;

    let cancelled = false;
    const loadStations = async () => {
      setMerra2Loading(true);
      setMerra2Error(null);
      setMerra2Notice(null);
      setMerra2DataDate(null);
      const requestedDate = merra2RequestedDate;

      try {
        const stations = await getMERRA2StationsByDate(requestedDate);
        if (cancelled) return;
        setMerra2DataDate(requestedDate);
        setMerra2Stations(stations);
        setMerra2Loading(false);
        setSelectedMerra2Station((prev) =>
          prev ? stations.find((s) => s.sitename === prev.sitename) ?? null : null
        );
        return;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const noDataForDate = /No station data found for date/i.test(message);
        if (!noDataForDate) {
          if (cancelled) return;
          setMerra2DataDate(null);
          setMerra2Stations([]);
          setSelectedMerra2Station(null);
          setMerra2Series([]);
          setMerra2Error(message || 'Failed to load MERRA2 stations.');
          return;
        }
      }

      // Requested date has no data — fall back to the latest available Parquet date.
      try {
        let latestDate = merra2LatestDate;
        if (!latestDate) {
          const latest = await getMERRA2LatestDate();
          latestDate = latest.latestDate;
          if (latestDate) setMerra2LatestDate(latestDate);
        }
        if (!latestDate) {
          throw new Error('MERRA2 latest parquet date is unavailable.');
        }
        const latestStations = await getMERRA2StationsByDate(latestDate);
        if (cancelled) return;
        setMerra2DataDate(latestDate);
        setMerra2Stations(latestStations);
        setMerra2Loading(false);
        setSelectedMerra2Station((prev) =>
          prev ? latestStations.find((s) => s.sitename === prev.sitename) ?? null : null
        );
        if (latestDate !== requestedDate) {
          setMerra2Notice(`No MERRA2 station data for ${requestedDate}. Showing latest available date: ${latestDate}.`);
        }
      } catch (err: unknown) {
        if (cancelled) return;
        setMerra2DataDate(null);
        setMerra2Stations([]);
        setSelectedMerra2Station(null);
        setMerra2Series([]);
        setMerra2Error(err instanceof Error ? err.message : 'Failed to load MERRA2 stations.');
      } finally {
        if (!cancelled) setMerra2Loading(false);
      }
    };

    loadStations();
    return () => {
      cancelled = true;
    };
  }, [merra2RequestedDate, preloadHistoricalLayers]);

  useEffect(() => {
    if (!preloadHistoricalLayers) return;

    let cancelled = false;
    const loadWashuStationData = async () => {
      setWashuStationsLoading(true);
      setWashuStationsError(null);
      setWashuStationsNotice(null);
      setWashuDataDate(null);
      const requestedDate = washuRequestedDate;

      try {
        const stations = await getWashUStationsByDate(requestedDate);
        if (cancelled) return;
        setWashuDataDate(requestedDate);
        setWashuStations(stations);
        setWashuStationsLoading(false);
        setSelectedWashuStation((prev) =>
          prev ? stations.find((s) => s.sitename === prev.sitename) ?? null : null
        );
        return;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const noDataForDate = /No WashU station data found for date/i.test(message);
        if (!noDataForDate) {
          if (cancelled) return;
          setWashuDataDate(null);
          setWashuStations([]);
          setSelectedWashuStation(null);
          setWashuStationSeries([]);
          setWashuStationsError(message || 'Failed to load WashU stations.');
          return;
        }
      }

      try {
        let latestDate = washuLatestDate;
        if (!latestDate) {
          const latest = await getWashULatestDate();
          latestDate = latest.latestDate;
          if (latestDate) setWashuLatestDate(latestDate);
        }
        if (!latestDate) {
          throw new Error('WashU latest parquet date is unavailable.');
        }
        const latestStations = await getWashUStationsByDate(latestDate);
        if (cancelled) return;
        setWashuDataDate(latestDate);
        setWashuStations(latestStations);
        setWashuStationsLoading(false);
        setSelectedWashuStation((prev) =>
          prev ? latestStations.find((s) => s.sitename === prev.sitename) ?? null : null
        );
        if (latestDate !== requestedDate) {
          setWashuStationsNotice(`No WashU station data for ${requestedDate}. Showing latest available date: ${latestDate}.`);
        }
      } catch (err: unknown) {
        if (cancelled) return;
        setWashuDataDate(null);
        setWashuStations([]);
        setSelectedWashuStation(null);
        setWashuStationSeries([]);
        setWashuStationsError(err instanceof Error ? err.message : 'Failed to load WashU stations.');
      } finally {
        if (!cancelled) setWashuStationsLoading(false);
      }
    };

    loadWashuStationData();
    return () => {
      cancelled = true;
    };
  }, [washuRequestedDate, preloadHistoricalLayers, washuLatestDate]);

  // Warm MERRA2 + WashU grid cubes in IndexedDB before the user switches layers.
  useEffect(() => {
    if (!preloadHistoricalLayers) return;
    void loadMerra2DailyCube(merra2RequestedDate).catch(() => {});
    void loadWashUGrid(
      washuPeriod,
      washuPeriodParts.year,
      washuPeriod === 'monthly' ? washuPeriodParts.month : null
    ).catch(() => {});
  }, [
    preloadHistoricalLayers,
    merra2RequestedDate,
    washuPeriod,
    washuPeriodParts.year,
    washuPeriodParts.month,
  ]);

  useEffect(() => {
    if (!preloadOpenAqLayers) return;
    let alive = true;
    let stopBackground: (() => void) | undefined;
    const date = effectiveSelectedDateStr;
    const mode = openAqMapMode;
    const monitorsOnly = openAqMonitorsOnly;

    setOpenAqError(null);
    setOpenAqLoading(true);

    const applyColored = (
      locations: Awaited<ReturnType<typeof getOpenAqLocations>>,
      stations: OpenAqStationRecord[]
    ) => {
      if (!alive) return;
      const merged = mergeOpenAqStationValues(locations, stations, mode);
      setOpenAqStations(merged);
      setSelectedOpenAqStation((prev) =>
        prev ? merged.find((s) => s.sensorId === prev.sensorId) ?? null : null
      );
      if (merged.some(hasOpenAqPm25Value)) setOpenAqLoading(false);
    };

    (async () => {
      try {
        // Paint positions immediately (gray), then replace with AQI colors from the API.
        const locations = await getOpenAqLocations(monitorsOnly);
        if (!alive) return;

        const cached = peekOpenAqStations(date, mode, monitorsOnly);
        const cachedCount = cached?.filter(hasOpenAqPm25Value).length ?? 0;
        if (cached && cachedCount > 0) {
          applyColored(locations, cached);
        } else {
          setOpenAqStations(skeletonStationsFromLocations(locations, mode));
        }

        // Always refetch so we never stick on a sparse/click-only snapshot.
        const stations = await getOpenAqStations(date, mode, monitorsOnly);
        if (!alive) return;
        applyColored(locations, stations);

        // Poll while archive (historical) or bulk latest (NRT) fill continues.
        stopBackground = refreshOpenAqStationsInBackground(
          date,
          mode,
          monitorsOnly,
          (enriched) => applyColored(locations, enriched)
        );
      } catch (err) {
        if (!alive) return;
        setOpenAqError(err instanceof Error ? err.message : 'Failed to load OpenAQ stations.');
        setOpenAqLoading(false);
      }
    })();

    return () => {
      alive = false;
      stopBackground?.();
    };
  }, [preloadOpenAqLayers, effectiveSelectedDateStr, openAqMapMode, openAqMonitorsOnly]);

  const openAqAnalysisStartDate = openAqAppliedRange.start;
  const openAqAnalysisEndDate = openAqAppliedRange.end;

  useEffect(() => {
    const calendarEnd = dayjs(effectiveSelectedDateStr, 'YYYY-MM-DD');
    const lastReading = selectedOpenAqStation?.datetime?.slice(0, 10)
      ?? selectedOpenAqStation?.datetimeLast?.slice(0, 10);
    const endBase = openAqChartRangeEnd(calendarEnd, lastReading, openAqMapMode);
    const nextTo = endBase;
    const nextFrom = endBase.subtract(6, 'day');
    setOpenAqDateFrom(nextFrom);
    setOpenAqDateTo(nextTo);
    setOpenAqAppliedRange({
      start: nextFrom.format('YYYY-MM-DD'),
      end: nextTo.format('YYYY-MM-DD'),
    });
  }, [effectiveSelectedDateStr, openAqMapMode, selectedOpenAqStation?.sensorId, selectedOpenAqStation?.datetime, selectedOpenAqStation?.datetimeLast]);

  useEffect(() => {
    if (!showOpenAq || !selectedOpenAqStation || openAqMapMode !== 'daily') {
      setOpenAqSeries([]);
      setOpenAqSeriesLoading(false);
      setOpenAqSeriesError(null);
      return;
    }
    const controller = new AbortController();
    setOpenAqSeriesLoading(true);
    setOpenAqSeriesError(null);
    getOpenAqTimeseries(
      selectedOpenAqStation.sensorId,
      openAqAnalysisStartDate,
      openAqAnalysisEndDate,
      'daily',
      {
        locationId: selectedOpenAqStation.locationId,
        signal: controller.signal,
      }
    )
      .then((res) => {
        if (controller.signal.aborted) return;
        setOpenAqSeries(Array.isArray(res.points) ? res.points : []);
      })
      .catch((err) => {
        if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) return;
        setOpenAqSeries([]);
        setOpenAqSeriesError(err instanceof Error ? err.message : 'Failed to load OpenAQ time series.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setOpenAqSeriesLoading(false);
      });
    return () => controller.abort();
  }, [showOpenAq, openAqMapMode, selectedOpenAqStation?.sensorId, selectedOpenAqStation?.locationId, openAqAnalysisStartDate, openAqAnalysisEndDate]);

  useEffect(() => {
    const endBase = dayjs(merra2RequestedDate, 'YYYY-MM-DD');
    const nextTo = endBase;
    const nextFrom = endBase.subtract(6, 'day');
    setMerra2DateFrom(nextFrom);
    setMerra2DateTo(nextTo);
    setMerra2AppliedRange({
      start: nextFrom.format('YYYY-MM-DD'),
      end: nextTo.format('YYYY-MM-DD'),
    });
  }, [merra2RequestedDate, selectedMerra2Station?.sitename]);

  useEffect(() => {
    if (!showMERRA2PM25 || !selectedMerra2Station) return;
    setMerra2SeriesLoading(true);
    setMerra2Error(null);
    getMERRA2StationTimeseries(
      selectedMerra2Station.sitename,
      merra2AnalysisStartDate,
      merra2AnalysisEndDate
    )
      .then((res) => {
        setMerra2Series(Array.isArray(res.points) ? res.points : []);
      })
      .catch((err) => {
        setMerra2Series([]);
        setMerra2Error(err?.message || 'Failed to load station time series.');
      })
      .finally(() => setMerra2SeriesLoading(false));
  }, [showMERRA2PM25, selectedMerra2Station?.sitename, merra2AnalysisStartDate, merra2AnalysisEndDate]);

  useEffect(() => {
    const { year, month } = washuPeriodParts;
    const defaults = defaultWashuStationSeriesRange(year, month);
    setWashuStationSeriesStartYear(defaults.startYear);
    setWashuStationSeriesStartMonth(defaults.startMonth);
    setWashuStationSeriesEndYear(defaults.endYear);
    setWashuStationSeriesEndMonth(defaults.endMonth);
    setWashuStationAppliedSeriesRange({
      ...defaults,
      granularity: washuStationSeriesGranularity,
    });
  }, [washuRequestedDate, selectedWashuStation?.sitename, washuPeriodParts.year, washuPeriodParts.month]);

  useEffect(() => {
    if (!showWashU || !selectedWashuStation) return;
    setWashuStationSeriesLoading(true);
    setWashuStationsError(null);
    const bounds = washuStationTimeseriesBounds(
      washuStationAppliedSeriesRange.startYear,
      washuStationAppliedSeriesRange.startMonth,
      washuStationAppliedSeriesRange.endYear,
      washuStationAppliedSeriesRange.endMonth,
      washuStationAppliedSeriesRange.granularity
    );
    getWashUStationTimeseries(
      selectedWashuStation.sitename,
      bounds.start,
      bounds.end,
      washuStationAppliedSeriesRange.granularity
    )
      .then((res) => {
        setWashuStationSeries(Array.isArray(res.points) ? res.points : []);
      })
      .catch((err) => {
        setWashuStationSeries([]);
        setWashuStationsError(err?.message || 'Failed to load WashU station time series.');
      })
      .finally(() => setWashuStationSeriesLoading(false));
  }, [
    showWashU,
    selectedWashuStation?.sitename,
    washuStationAppliedSeriesRange.startYear,
    washuStationAppliedSeriesRange.startMonth,
    washuStationAppliedSeriesRange.endYear,
    washuStationAppliedSeriesRange.endMonth,
    washuStationAppliedSeriesRange.granularity,
  ]);

  const pointsInCircle = useMemo(() => {
    if (!showFires || !circleCenter) return [];
    const [cLat, cLng] = circleCenter;
    const radiusM = circleRadiusKm * 1000;
    const inCircle = firePoints.filter((p) => {
      if (isNaN(p.latitude) || isNaN(p.longitude)) return false;
      return distanceMeters(cLat, cLng, p.latitude, p.longitude) <= radiusM;
    });
    const seen = new Set<string>();
    return inCircle.filter((p) => {
      const key = `${p.latitude.toFixed(6)}_${p.longitude.toFixed(6)}_${p.acq_date}_${p.acq_time ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [showFires, circleCenter, circleRadiusKm, firePoints]);

  const pointsInRectangle = useMemo(() => {
    if (!showFires || !fireChartBounds) return [];
    const inRect = firePoints.filter((p) =>
      isPointInLatLonBounds(p.latitude, p.longitude, fireChartBounds)
    );
    const seen = new Set<string>();
    return inRect.filter((p) => {
      const key = `${p.latitude.toFixed(6)}_${p.longitude.toFixed(6)}_${p.acq_date}_${p.acq_time ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [showFires, fireChartBounds, firePoints]);

  const pointsInSelection = useMemo(() => {
    if (circleCenter) return pointsInCircle;
    if (fireChartBounds) return pointsInRectangle;
    return [];
  }, [circleCenter, fireChartBounds, pointsInCircle, pointsInRectangle]);

  const selectedDateForMap = useMemo(
    () => (selectedDate.isAfter(dayjs(), 'day') ? dayjs().format('YYYY-MM-DD') : selectedDate.format('YYYY-MM-DD')),
    [selectedDate]
  );

  const derivedSiteAodMap = useMemo(
    () =>
      Object.keys(siteAodMap).length > 0
        ? siteAodMap
        : selectedSite && chartData.length > 0
          ? { [selectedSite.site]: { hasData: true }, [selectedSite.name ?? '']: { hasData: true } }
          : siteAodMap,
    [siteAodMap, selectedSite, chartData]
  );

  const handleCircleCenterChange = useCallback((lat: number, lng: number) => {
    setCircleCenter([lat, lng]);
  }, []);

  const handleCircleClose = useCallback(() => {
    setCircleCenter(null);
    setCircleSelectActive(false);
    setFireChartBounds(null);
    setFireChartRectDrawActive(false);
  }, []);

  const dailyMeanAod = useMemo(() => computeDailyMeanAOD(chartData), [chartData]);


  const handleAeronetSiteClick = useCallback((site: AERONETSite) => {
    setSelectedSite(site);
    setSelectedFire(null);
    setSelectedMerra2Station(null);
    setSelectedOpenAqStation(null);
    setSelectedAAQE(null);
    setAnalysisAnchor(anchorFromAeronet(site));
    setChartData([]);
    setLeftPanelOpen(false);
    setRightPanelOpen(true);
  }, []);

  const clearAnalysisAnchor = useCallback(() => {
    setAnalysisAnchor(null);
  }, []);

  const exportAODCSV = () => {
    if (!selectedSite || chartData.length === 0) return;
    const headers = ['date', 'time', 'dayOfYear', 'AOD_500nm', 'AOD_675nm', 'AOD_870nm', 'AOD_1020nm'];
    const rows = chartData.map((d) =>
      [d.date, d.time ?? '', d.dayOfYear ?? '', d.AOD_500nm ?? '', d.AOD_675nm ?? '', d.AOD_870nm ?? '', d.AOD_1020nm ?? ''].join(',')
    );
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AERONET_${selectedSite.site}_${analysisStartDate}_to_${analysisEndDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFireClick = useCallback((fire: FIRMSFirePoint) => {
    setSelectedSite(null);
    setSelectedMerra2Station(null);
    setSelectedOpenAqStation(null);
    setSelectedAAQE(null);
    setChartData([]);
    setLeftPanelOpen(false);
    setRightPanelOpen(true);
    setAnalysisAnchor(anchorFromFire(fire.latitude, fire.longitude));
    setSelectedFire({
      latitude: fire.latitude,
      longitude: fire.longitude,
      bright_ti4: fire.bright_ti4,
      bright_ti5: fire.bright_ti5,
      scan: fire.scan,
      track: fire.track,
      acq_date: fire.acq_date,
      acq_time: fire.acq_time,
      satellite: fire.satellite,
      instrument: fire.instrument,
      confidence: fire.confidence,
      version: fire.version,
      frp: fire.frp,
      daynight: fire.daynight,
    });
  }, []);

  const handleAAQEForecastClick = useCallback((point: AAQEForecastPoint) => {
    const props = point.properties ?? {};
    const hourlyPm = Object.entries(props)
      .filter(([k, v]) => /^3HR_PM_CONC_CNN\(\d+\)$/.test(k) && typeof v === 'number')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => ({ label: k, value: v as number }));
    const hourlyAqi = Object.entries(props)
      .filter(([k, v]) => /^3HR_AQI\(\d+\)$/.test(k) && typeof v === 'number')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => ({ label: k, value: v as number }));
    const { aqi: displayAqi, pm: displayPm } = getAaqeDisplayValues(
      props,
      aaqeDisplayType,
      aaqeTimeCode
    );
    const siteName = typeof props.Site_Name === 'string' ? props.Site_Name : undefined;
    const station = typeof props.Station === 'string' ? props.Station : undefined;
    setAnalysisAnchor(
      anchorFromAaqe({
        latitude: point.latitude,
        longitude: point.longitude,
        siteName,
        station,
      })
    );
    setSelectedAAQE({
      latitude: point.latitude,
      longitude: point.longitude,
      station,
      siteName,
      utcDate: typeof props.UTC_DATE === 'string' ? props.UTC_DATE : undefined,
      dailyAqi: displayAqi ?? undefined,
      selectedPm: displayPm ?? undefined,
      selectedTimeCode: aaqeTimeCode,
      hourlyPm,
      hourlyAqi,
      selectedAqiCategory: getAqiCategory(displayAqi).label,
    });
    setSelectedSite(null);
    setSelectedMerra2Station(null);
    setSelectedOpenAqStation(null);
    setSelectedFire(null);
    setChartData([]);
    setLeftPanelOpen(false);
    setRightPanelOpen(true);
  }, [aaqeTimeCode, aaqeDisplayType]);

  const handleFireChartBoundsCommit = useCallback((bounds: LatLonBounds) => {
    setFireChartBounds(bounds);
    setFireChartRectDrawActive(false);
  }, []);

  const clearFireChartRectangle = useCallback(() => {
    setFireChartBounds(null);
    setFireChartRectDrawActive(false);
  }, []);

  const toggleLayer = useCallback((layer: LayerMode) => {
    setActiveLayers((prev) => {
      const isOn = prev.includes(layer);
      if (isOn) {
        if (prev.length <= 1) return prev;
        if (layer === 'fires') {
          setCircleSelectActive(false);
          setCircleCenter(null);
          setFireChartRectDrawActive(false);
          setFireChartBounds(null);
        }
        if (layer === 'openaq') setSelectedOpenAqStation(null);
        if (layer === 'fires') setSelectedFire(null);
        if (layer === 'merra2') setSelectedMerra2Station(null);
        if (layer === 'aaqe') setSelectedAAQE(null);
        if (layer === 'washu') setWashuPin(null);
        if (layer === 'washu') setSelectedWashuStation(null);
        if (layer === 'aeronet') setSelectedSite(null);
        setPrimaryLayer((p) => (p === layer ? prev.find((l) => l !== layer) ?? p : p));
        return prev.filter((l) => l !== layer);
      }

      if (layer === 'merra2') {
        setSelectedDate(merra2DefaultDate(merra2LatestDate));
      } else if (workflow === 'historical' && layer === 'openaq') {
        setSelectedDate(openAqHistoricalDefaultDate(openAqArchiveCutoffDate));
        setOpenAqMapMode('daily');
      } else if (workflow === 'historical' && layer === 'aeronet') {
        setSelectedDate(todayDefaultDate());
      } else if (workflow === 'historical' && layer === 'washu') {
        setSelectedDate(dayjs(MERRA2_DEFAULT_DATE, 'YYYY-MM-DD'));
      }
      if (layer === 'washu') {
        const maxSupported = dayjs(MERRA2_DEFAULT_DATE, 'YYYY-MM-DD');
        setSelectedDate((prevDate) => (prevDate.isAfter(maxSupported, 'day') ? maxSupported : prevDate));
        setWashuPin(null);
        setWashuSeries([]);
      }
      if (layer === 'openaq' && workflow === 'nrt') {
        setSelectedDate(todayDefaultDate());
        setOpenAqMapMode('latest');
      }
      setPrimaryLayer(layer);
      return [...prev, layer];
    });
  }, [merra2LatestDate, openAqArchiveCutoffDate, workflow]);

  const changeWorkflow = useCallback(
    (next: DashboardV1Workflow) => {
      setWorkflow(next);
      const defaultLayer = DASHBOARD_V1_WORKFLOW_META[next].defaultLayer;
      setActiveLayers([defaultLayer]);
      setPrimaryLayer(defaultLayer);
      if (next === 'nrt') {
        setSelectedDate(todayDefaultDate());
        setOpenAqMapMode('latest');
        setSelectedOpenAqStation(null);
      }
      if (next === 'historical') {
        setOpenAqMapMode('daily');
        setSelectedDate(todayDefaultDate());
      }
    },
    []
  );

  const renderLayerToggle = (layer: LayerMode, loading?: boolean) => (
    <label key={layer} className={`layer-checkbox${layerOn(layer) ? ' layer-checkbox--on' : ''}`}>
      <input
        type="checkbox"
        checked={layerOn(layer)}
        onChange={() => toggleLayer(layer)}
      />
      {DASHBOARD_V1_LAYER_LABELS[layer]}
      {loading ? ' (loading…)' : ''}
    </label>
  );

  const applyMerra2Range = useCallback(() => {
    const from = merra2DateFrom;
    const to = merra2DateTo;
    const start = from.isAfter(to, 'day') ? to : from;
    const end = from.isAfter(to, 'day') ? from : to;
    setMerra2AppliedRange({
      start: start.format('YYYY-MM-DD'),
      end: end.format('YYYY-MM-DD'),
    });
  }, [merra2DateFrom, merra2DateTo]);

  const resetMerra2Range = useCallback(() => {
    const endBase = dayjs(merra2RequestedDate, 'YYYY-MM-DD');
    const nextTo = endBase;
    const nextFrom = endBase.subtract(6, 'day');
    setMerra2DateFrom(nextFrom);
    setMerra2DateTo(nextTo);
    setMerra2AppliedRange({
      start: nextFrom.format('YYYY-MM-DD'),
      end: nextTo.format('YYYY-MM-DD'),
    });
  }, [merra2RequestedDate]);

  const applyWashuStationRange = useCallback(() => {
    setWashuStationAppliedSeriesRange({
      startYear: washuStationSeriesStartYear,
      startMonth: washuStationSeriesStartMonth,
      endYear: washuStationSeriesEndYear,
      endMonth: washuStationSeriesEndMonth,
      granularity: washuStationSeriesGranularity,
    });
  }, [
    washuStationSeriesStartYear,
    washuStationSeriesStartMonth,
    washuStationSeriesEndYear,
    washuStationSeriesEndMonth,
    washuStationSeriesGranularity,
  ]);

  const resetWashuStationRange = useCallback(() => {
    const { year, month } = washuPeriodParts;
    const defaults = defaultWashuStationSeriesRange(year, month);
    setWashuStationSeriesStartYear(defaults.startYear);
    setWashuStationSeriesStartMonth(defaults.startMonth);
    setWashuStationSeriesEndYear(defaults.endYear);
    setWashuStationSeriesEndMonth(defaults.endMonth);
    setWashuStationAppliedSeriesRange({
      ...defaults,
      granularity: washuStationSeriesGranularity,
    });
  }, [washuPeriodParts, washuStationSeriesGranularity]);

  const applyOpenAqRange = useCallback(() => {
    const from = openAqDateFrom;
    const to = openAqDateTo;
    const start = from.isAfter(to, 'day') ? to : from;
    const end = from.isAfter(to, 'day') ? from : to;
    setOpenAqAppliedRange({
      start: start.format('YYYY-MM-DD'),
      end: end.format('YYYY-MM-DD'),
    });
  }, [openAqDateFrom, openAqDateTo]);

  const resetOpenAqRange = useCallback(() => {
    const calendarEnd = dayjs(effectiveSelectedDateStr, 'YYYY-MM-DD');
    const lastReading = selectedOpenAqStation?.datetime?.slice(0, 10)
      ?? selectedOpenAqStation?.datetimeLast?.slice(0, 10);
    const endBase = openAqChartRangeEnd(calendarEnd, lastReading, openAqMapMode);
    const nextTo = endBase;
    const nextFrom = endBase.subtract(6, 'day');
    setOpenAqDateFrom(nextFrom);
    setOpenAqDateTo(nextTo);
    setOpenAqAppliedRange({
      start: nextFrom.format('YYYY-MM-DD'),
      end: nextTo.format('YYYY-MM-DD'),
    });
  }, [effectiveSelectedDateStr, openAqMapMode, selectedOpenAqStation?.datetime, selectedOpenAqStation?.datetimeLast]);

  const handleWashuMapClick = useCallback((lat: number, lon: number) => {
    setWashuPin({ lat, lon, pm25: null });
    setSelectedWashuStation(null);
    setSelectedSite(null);
    setSelectedFire(null);
    setSelectedMerra2Station(null);
    setSelectedOpenAqStation(null);
    setSelectedAAQE(null);
    setLeftPanelOpen(false);
    setRightPanelOpen(true);
  }, []);

  const applyWashuSeriesRange = useCallback(() => {
    setWashuAppliedSeriesRange({
      startYear: washuSeriesStartYear,
      startMonth: washuSeriesStartMonth,
      endYear: washuSeriesEndYear,
      endMonth: washuSeriesEndMonth,
    });
  }, [washuSeriesStartYear, washuSeriesStartMonth, washuSeriesEndYear, washuSeriesEndMonth]);

  useEffect(() => {
    if (!showWashU || !washuPin) return;
    let cancelled = false;
    setWashuSeriesLoading(true);
    setWashuSeriesError(null);
    fetchWashUTimeseries({
      lat: washuPin.lat,
      lon: washuPin.lon,
      startYear: washuAppliedSeriesRange.startYear,
      startMonth: washuAppliedSeriesRange.startMonth,
      endYear: washuAppliedSeriesRange.endYear,
      endMonth: washuAppliedSeriesRange.endMonth,
    })
      .then((res) => {
        if (cancelled) return;
        setWashuSeries(res.points ?? []);
        const count = res.points?.length ?? 0;
        const expected = res.monthCount ?? 0;
        if (count === 0) {
          setWashuSeriesError('No PM2.5 values for this location in the selected range.');
        } else if (expected > 0 && count < expected) {
          setWashuSeriesError(null);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setWashuSeries([]);
        setWashuSeriesError(err instanceof Error ? err.message : 'WashU timeseries failed');
      })
      .finally(() => {
        if (!cancelled) setWashuSeriesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showWashU, washuPin, washuAppliedSeriesRange]);

  const merra2PanelDataDate = merra2DataDate ?? merra2RequestedDate;
  const merra2PanelStation = useMemo(() => {
    if (!selectedMerra2Station) return null;
    if (!merra2DataDate) return selectedMerra2Station;
    return (
      merra2Stations.find((s) => s.sitename === selectedMerra2Station.sitename) ??
      selectedMerra2Station
    );
  }, [selectedMerra2Station, merra2DataDate, merra2Stations]);
  const merra2PanelMetricsLoading = Boolean(selectedMerra2Station) && merra2Loading;
  const washuPanelDataDate = washuDataDate ?? washuRequestedDate;
  const washuPanelStation = useMemo(() => {
    if (!selectedWashuStation) return null;
    if (!washuDataDate) return selectedWashuStation;
    return (
      washuStations.find((s) => s.sitename === selectedWashuStation.sitename) ??
      selectedWashuStation
    );
  }, [selectedWashuStation, washuDataDate, washuStations]);
  const washuPanelMetricsLoading = Boolean(selectedWashuStation) && washuStationsLoading;

  const activeSelectedSite = selectedSite;
  const activeSelectedFire = selectedFire;
  const activeSelectedMerra2Station = merra2PanelStation;
  const activeSelectedWashuStation = washuPanelStation;
  const activeSelectedOpenAq = selectedOpenAqStation;
  const activeSelectedAAQE = selectedAAQE;
  const aaqeForecastDateOptions = useMemo(() => {
    if (!showAAQEForecast) return [];
    const base = selectedDate.isAfter(dayjs(), 'day') ? dayjs() : selectedDate;
    return getAaqeForecastDaysAfterSelected(base.format('YYYY-MM-DD'));
  }, [showAAQEForecast, selectedDate]);
  const aaqeTimeOptions = [
    { code: '130', label: '1:30 UTC' },
    { code: '430', label: '4:30 UTC' },
    { code: '730', label: '7:30 UTC' },
    { code: '1030', label: '10:30 UTC' },
    { code: '1330', label: '13:30 UTC' },
    { code: '1630', label: '16:30 UTC' },
    { code: '1930', label: '19:30 UTC' },
    { code: '2230', label: '22:30 UTC' },
  ];
  const aaqeThreeDaySeries = useMemo(() => {
    if (!activeSelectedAAQE) return [];
    const stationKey = activeSelectedAAQE.station ?? activeSelectedAAQE.siteName;
    if (!stationKey) return [];
    const normalized = stationKey.toLowerCase();
    const points: Array<{ date: string; aqi: number }> = [];
    for (const { iso: d } of aaqeForecastDateOptions) {
      const dayPoints = aaqeForecastByDate[d] ?? [];
      const hit = dayPoints.find((p) => {
        const st = String(p.properties.Station ?? '').toLowerCase();
        const name = String(p.properties.Site_Name ?? '').toLowerCase();
        return st === normalized || name === normalized;
      });
      if (!hit) continue;
      const raw = hit.properties.DAILY_AQI;
      const value =
        typeof raw === 'number'
          ? raw
          : Number.isFinite(Number(raw))
            ? Number(raw)
            : null;
      if (value == null) continue;
      points.push({ date: d, aqi: value });
    }
    return points;
  }, [activeSelectedAAQE, aaqeForecastByDate, aaqeForecastDateOptions]);
  const aaqeThreeDayRows = useMemo(
    () =>
      aaqeThreeDaySeries.map((p, idx) => ({
        label: `Day ${idx + 1}`,
        date: formatDateMonthDayYear(p.date),
        aqi: p.aqi,
      })),
    [aaqeThreeDaySeries]
  );
  const selectedMerra2Aqi = activeSelectedMerra2Station
    ? calculateAQIFromPm25(activeSelectedMerra2Station.pm25)
    : null;
  const selectedWashuStationAqi = activeSelectedWashuStation
    ? calculateAQIFromPm25(activeSelectedWashuStation.pm25)
    : null;
  const selectedOpenAqDayPoint = useMemo(() => {
    if (!activeSelectedOpenAq) return null;
    if (openAqMapMode === 'daily') {
      return openAqSeries.find((p) => p.date === effectiveSelectedDateStr) ?? null;
    }
    if (openAqSeries.length === 0) return null;
    return openAqSeries[openAqSeries.length - 1];
  }, [activeSelectedOpenAq, openAqMapMode, openAqSeries, effectiveSelectedDateStr]);
  const selectedOpenAqPanelStation = useMemo(() => {
    if (!activeSelectedOpenAq) return null;
    if (hasOpenAqPm25Value(activeSelectedOpenAq)) return activeSelectedOpenAq;
    if (selectedOpenAqDayPoint) {
      return {
        ...activeSelectedOpenAq,
        pm25: selectedOpenAqDayPoint.pm25,
        datetime: selectedOpenAqDayPoint.datetime,
        hasReading: true,
      };
    }
    return activeSelectedOpenAq;
  }, [activeSelectedOpenAq, selectedOpenAqDayPoint]);
  const selectedOpenAqAqi =
    selectedOpenAqPanelStation && hasOpenAqPm25Value(selectedOpenAqPanelStation)
      ? calculateAQIFromPm25(selectedOpenAqPanelStation.pm25!)
      : null;
  const openAqWithDataCount = useMemo(
    () => openAqStations.filter(hasOpenAqPm25Value).length,
    [openAqStations]
  );
  const openAqDailyModeIsToday = useMemo(
    () => openAqMapMode === 'daily' && effectiveSelectedDateStr === dayjs().format('YYYY-MM-DD'),
    [openAqMapMode, effectiveSelectedDateStr]
  );
  const openAqChartDisplayPoints = useMemo(() => {
    if (openAqSeries.length > 0) return openAqSeries;
    if (!selectedOpenAqStation) return [];
    return seedOpenAqTimeseriesFromStation(
      selectedOpenAqStation,
      openAqMapMode === 'daily' ? effectiveSelectedDateStr : undefined
    );
  }, [openAqSeries, selectedOpenAqStation, openAqMapMode, effectiveSelectedDateStr]);
  const hasMapSelection = Boolean(
    activeSelectedSite ||
      activeSelectedFire ||
      activeSelectedMerra2Station ||
      activeSelectedWashuStation ||
      activeSelectedAAQE ||
      activeSelectedOpenAq ||
      washuPin
  );
  const showRightPanel = hasMapSelection || analysisAnchor != null;
  const closeMobileDrawers = useCallback(() => {
    setLeftPanelOpen(false);
    setRightPanelOpen(false);
  }, []);

  return (
    <div className="dashboard-page">
        <div className={`dashboard-layout${isCompactLayout ? ' dashboard-layout--compact' : ''}`}>
          {isCompactLayout && (leftPanelOpen || (rightPanelOpen && showRightPanel)) && (
            <button
              type="button"
              className="dashboard-drawer-backdrop"
              aria-label="Close panels"
              onClick={closeMobileDrawers}
            />
          )}
          <aside
            className={`dashboard-sidebar-left${isCompactLayout ? ' dashboard-sidebar-drawer' : ''}${isCompactLayout && leftPanelOpen ? ' is-open' : ''}${!isCompactLayout && sidebarCollapsed ? ' dashboard-sidebar-left--collapsed' : ''}${!isCompactLayout && sidebarCollapsed && sidebarPeek ? ' dashboard-sidebar-left--peek' : ''}`}
            onMouseEnter={() => {
              if (!isCompactLayout && sidebarCollapsed) setSidebarPeek(true);
            }}
            onMouseLeave={() => {
              if (!isCompactLayout && sidebarCollapsed) setSidebarPeek(false);
            }}
          >
            {!isCompactLayout && (
              <button
                type="button"
                className="sidebar-collapse-btn"
                onClick={() => {
                  setSidebarCollapsed((c) => !c);
                  setSidebarPeek(false);
                }}
                aria-label={sidebarCollapsed ? 'Expand layers panel' : 'Collapse layers panel'}
                title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              >
                {sidebarCollapsed ? '›' : '‹'}
              </button>
            )}
            <div className="sidebar-rail" aria-hidden={!sidebarCollapsed || sidebarPeek}>
              <span className="sidebar-rail-icon">☰</span>
              <span className="sidebar-rail-label">Layers</span>
            </div>
            <div className="sidebar-panel-body">
            <div className="sidebar-section">
              <h6>Date Selection</h6>
              <DatePicker
                label="Select Date:"
                value={selectedDate}
                onChange={(d) => d && setSelectedDate(d)}
                maxDate={dayjs()}
                slotProps={{ textField: { size: 'small', fullWidth: true } }}
              />
            </div>
            <div className="sidebar-section">
              <h6>Analysis Workflow</h6>
              <div className="workflow-tabs" role="group" aria-label="Analysis workflow">
                {DASHBOARD_V1_WORKFLOW_TABS.map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    className={`workflow-btn${workflow === id ? ' active' : ''}`}
                    onClick={() => changeWorkflow(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="workflow-desc">{DASHBOARD_V1_WORKFLOW_META[workflow].description}</p>
            </div>
            <div className="sidebar-section">
              <h6>Data Layers</h6>
              {workflow === 'historical' && (
                <>
              {renderLayerToggle('aeronet', aeronetLoading)}
              {showAeronet && (
                <div className="aeronet-aod-version aeronet-subcontrol">
                  <label style={{ fontSize: 12, color: '#666', fontWeight: 600, display: 'block', marginTop: 6 }}>
                    AOD Version
                  </label>
                  <select
                    className="site-select"
                    value={String(aeronetAodVersion)}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setAeronetAodVersion(v as AERONETAODVersion);
                    }}
                  >
                    <option value="1">1.0 (AOD10)</option>
                    <option value="1.5">1.5 (AOD15)</option>
                    <option value="2">2.0 (AOD20)</option>
                  </select>
                </div>
              )}
              {showAeronet && (
                <div className="aeronet-date-range aeronet-subcontrol">
                  <DatePicker
                    label="From"
                    value={aeronetDateFrom}
                    onChange={(d) => d && setAeronetDateFrom(d)}
                    slotProps={{ textField: { size: 'small', fullWidth: true } }}
                  />
                  <DatePicker
                    label="To"
                    value={aeronetDateTo}
                    onChange={(d) => d && setAeronetDateTo(d)}
                    slotProps={{ textField: { size: 'small', fullWidth: true } }}
                  />
                  {aeronetDateFrom.isAfter(aeronetDateTo) && (
                    <small className="layer-tip" style={{ color: 'var(--warning, #b45309)' }}>From is after To — using swapped range</small>
                  )}
                </div>
              )}
              {showAeronet && aeronetSites.length > 0 && (
                <>
                  <select
                    className="site-select aeronet-subcontrol"
                    value={selectedSite?.site ?? ''}
                    onChange={(e) => {
                      const site = aeronetSites.find((s) => s.site === e.target.value);
                      if (site) handleAeronetSiteClick(site);
                    }}
                  >
                    <option value="">Select a site...</option>
                    {aeronetSites.map((s) => (
                      <option key={s.site} value={s.site}>{s.name ?? s.site}</option>
                    ))}
                  </select>
                </>
              )}
              {renderLayerToggle('merra2', merra2Loading)}
              {showMERRA2PM25 && (
                <>
                  <label className="layer-checkbox fire-subcontrol">
                    <input
                      type="checkbox"
                      checked={merra2ShowStations}
                      onChange={(e) => setMerra2ShowStations(e.target.checked)}
                    />
                    Station markers
                  </label>
                  <label className="layer-checkbox fire-subcontrol">
                    <input
                      type="checkbox"
                      checked={merra2ShowGridOverlay}
                      onChange={(e) => {
                        setMerra2ShowGridOverlay(e.target.checked);
                        if (!e.target.checked) {
                          setMerra2GridSource(null);
                          setMerra2GridFallbackReason(null);
                        }
                      }}
                    />
                    CNN PM2.5 grid overlay
                  </label>
                  {merra2ShowStations && (
                    <small className="layer-tip">
                      Click a station for PM2.5 / AQI details. AQI scale on map when markers are on.
                    </small>
                  )}
                  {merra2Error && <small className="layer-tip layer-tip-warn">⚠ {merra2Error}</small>}
                  {merra2Notice && <small className="layer-tip">{merra2Notice}</small>}
                  {merra2ShowGridOverlay && (
                    <div className="aeronet-subcontrol" style={{ marginTop: 8 }}>
                      <label style={{ fontSize: 12, color: '#666', fontWeight: 600, display: 'block' }}>
                        Grid hour (UTC): {String(merra2GridHour).padStart(2, '0')}:00
                        {merra2GridLoading && ' · loading daily file…'}
                      </label>
                      <input
                        type="range"
                        min={0}
                        max={23}
                        step={1}
                        value={merra2GridHour}
                        onChange={(e) => setMerra2GridHour(Number(e.target.value))}
                        style={{ width: '100%', marginTop: 6 }}
                        aria-label="MERRA2 grid UTC hour"
                      />
                      <small className="layer-tip" style={{ display: 'block', marginTop: 4 }}>
                        Daily NetCDF has 24 hourly slices. Data loads once per date and caches in your browser.
                        Native 0.625°×0.5° cells — no interpolation.
                      </small>
                    </div>
                  )}
                  {merra2ShowGridOverlay && merra2GridSource === 'sample' && (
                    <small className="layer-tip layer-tip-warn">
                      ⚠ Grid showing sample data
                      {merra2GridFallbackReason?.includes('opendap') || merra2GridFallbackReason?.includes('netcdf')
                        ? ' — no NASA granule for this date, or Earthdata download failed'
                        : ' — check Earthdata credentials and restart backend'}
                      {merra2GridFallbackReason ? ` (${merra2GridFallbackReason})` : ''}.
                      {effectiveSelectedDate.isAfter(dayjs(merra2LatestDate ?? '2025-12-31', 'YYYY-MM-DD'), 'day') &&
                        merra2LatestDate &&
                        ` Try ${merra2LatestDate} or earlier.`}
                    </small>
                  )}
                </>
              )}
              {renderLayerToggle('washu', washuGridLoading || washuStationsLoading)}
              {showWashU && (
                <>
                  <label className="layer-checkbox fire-subcontrol">
                    <input
                      type="checkbox"
                      checked={washuShowStations}
                      onChange={(e) => setWashuShowStations(e.target.checked)}
                    />
                    Station markers (parquet · monthly means)
                  </label>
                  <label className="layer-checkbox fire-subcontrol">
                    <input
                      type="checkbox"
                      checked={washuShowGridOverlay}
                      onChange={(e) => {
                        setWashuShowGridOverlay(e.target.checked);
                        if (!e.target.checked) {
                          setWashuGridSource(null);
                          setWashuGridFallbackReason(null);
                        }
                      }}
                    />
                    SatPM2.5 grid overlay
                  </label>
                  <div className="aeronet-subcontrol" style={{ marginTop: 8 }}>
                    <label style={{ fontSize: 12, color: '#666', fontWeight: 600, display: 'block' }}>
                      Temporal product
                    </label>
                    <select
                      className="site-select"
                      style={{ marginTop: 4 }}
                      value={washuPeriod}
                      onChange={(e) => setWashuPeriod(e.target.value as 'monthly' | 'annual')}
                    >
                      <option value="monthly">Monthly mean</option>
                      <option value="annual">Annual mean</option>
                    </select>
                  </div>
                  <small className="layer-tip">
                    Select date sets {washuPeriod === 'monthly' ? 'year + month' : 'year'} (1998–2023). Showing{' '}
                    <strong>{washuPeriodLabel}</strong>.
                    {washuShowStations ? ' Click a station for monthly/annual PM2.5 trends.' : ''}
                    {washuShowGridOverlay ? ' Click the map to pin a grid location for monthly series.' : ''}
                  </small>
                  {washuStationsError && <small className="layer-tip layer-tip-warn">⚠ {washuStationsError}</small>}
                  {washuStationsNotice && <small className="layer-tip">{washuStationsNotice}</small>}
                  {washuGridSource === 'sample' && (
                    <small className="layer-tip layer-tip-warn">
                      ⚠ Grid showing sample data — SatPM download or Python worker failed
                      {washuGridFallbackReason ? ` (${washuGridFallbackReason})` : ''}.
                      Install <code>netCDF4</code> and ensure outbound HTTPS is allowed.
                    </small>
                  )}
                </>
              )}
              {renderLayerToggle('openaq', openAqLoading)}
              {showOpenAq && (
                <>
                  <label className="layer-checkbox fire-subcontrol">
                    <input
                      type="checkbox"
                      checked={openAqMonitorsOnly}
                      onChange={(e) => setOpenAqMonitorsOnly(e.target.checked)}
                    />
                    Reference monitors only
                  </label>
                  <small className="layer-tip">
                    Daily mean PM2.5 for the selected map date
                    {openAqArchiveCutoffDate
                      ? ` (latest archive day: ${formatDateMonthDayYear(openAqArchiveCutoffDate)})`
                      : ''}.
                  </small>
                  {openAqArchiveCutoffDate && effectiveSelectedDateStr !== openAqArchiveCutoffDate && (
                    <button
                      type="button"
                      className="export-csv-btn"
                      style={{ marginTop: 6 }}
                      onClick={() => setSelectedDate(openAqHistoricalDefaultDate(openAqArchiveCutoffDate))}
                    >
                      Use latest archive date ({formatDateMonthDayYear(openAqArchiveCutoffDate)})
                    </button>
                  )}
                  {openAqDailyModeIsToday ? (
                    <small className="layer-tip layer-tip-warn">
                      Today isn&apos;t finished yet — pick the latest archive date or earlier for a daily mean.
                    </small>
                  ) : (
                    openAqStations.length > 0 && (
                      <small className="layer-tip">
                        {openAqWithDataCount} of {openAqStations.length} stations with PM2.5
                        {openAqWithDataCount === 0 && !openAqLoading ? ' for this date' : ''}
                        {openAqLoading ? ' · loading…' : ''}.
                        {' '}Gray = no reading that day; colors = AQI from PM2.5.
                      </small>
                    )
                  )}
                  {openAqError && <small className="layer-tip layer-tip-warn">⚠ {openAqError}</small>}
                </>
              )}

                </>
              )}
              {workflow === 'nrt' && (
                <>
              {renderLayerToggle('fires', fireLoading)}
              {showFires && (
                <>
                  <label className="layer-checkbox fire-subcontrol">
                    <input
                      type="checkbox"
                      checked={fireChartRectDrawActive}
                      onChange={(e) => setFireChartRectDrawActive(e.target.checked)}
                    />
                    Filter fire charts by rectangle (drag on map)
                  </label>
                  {fireChartRectDrawActive && (
                    <small className="layer-tip">Drag on the map to set the chart region.</small>
                  )}
                  {fireChartBounds && (
                    <button type="button" className="export-csv-btn" style={{ marginTop: 6 }} onClick={clearFireChartRectangle}>
                      Clear chart rectangle
                    </button>
                  )}
                </>
              )}
              {renderLayerToggle('viirs')}
              {showVIIRSImagery && (
                <small className="layer-tip">NASA GIBS VIIRS NOAA-21 true-color imagery for the selected date.</small>
              )}
              {renderLayerToggle('openaq', openAqLoading)}
              {showOpenAq && (
                <>
                  <label className="layer-checkbox fire-subcontrol">
                    <input
                      type="checkbox"
                      checked={openAqMonitorsOnly}
                      onChange={(e) => setOpenAqMonitorsOnly(e.target.checked)}
                    />
                    Reference monitors only
                  </label>
                  <small className="layer-tip">
                    OpenAQ readings for the selected date only. No reading that day = gray.
                  </small>
                  {openAqStations.length > 0 && (
                    <small className="layer-tip">
                      {openAqWithDataCount} of {openAqStations.length} stations with PM2.5.
                    </small>
                  )}
                  {openAqError && <small className="layer-tip layer-tip-warn">⚠ {openAqError}</small>}
                </>
              )}
                </>
              )}
              {workflow === 'forecast' && (
                <>
              {renderLayerToggle('aaqe', aaqeLoading)}
              {showAAQEForecast && (
                <small className="layer-tip">
                  Select Date = model initialization. Forecast dates: selected day + next 2 days.
                  {aaqeInitDate && ` Data run: ${formatDateMonthDayYear(aaqeInitDate)}.`}
                </small>
              )}
              {showAAQEForecast && (
                <div className="aeronet-subcontrol" style={{ marginTop: 8 }}>
                  <label style={{ fontSize: 12, color: '#666', fontWeight: 600, display: 'block' }}>
                    Forecast Date
                  </label>
                  <select
                    className="site-select"
                    style={{ marginTop: 4 }}
                    value={aaqeForecastDayIndex}
                    onChange={(e) => {
                      const idx = Number(e.target.value);
                      setAaqeForecastDayIndex(idx);
                      const opt = aaqeForecastDateOptions.find((o) => o.dayIndex === idx);
                      if (opt) setAaqeForecastDate(opt.iso);
                    }}
                  >
                    {aaqeForecastDateOptions.map((d) => (
                      <option key={d.iso} value={d.dayIndex}>{d.label}</option>
                    ))}
                  </select>
                  <label style={{ fontSize: 12, color: '#666', fontWeight: 600, display: 'block', marginTop: 6 }}>
                    Type
                  </label>
                  <select
                    className="site-select"
                    style={{ marginTop: 4 }}
                    value={aaqeDisplayType}
                    onChange={(e) => setAaqeDisplayType(e.target.value as AaqeDisplayType)}
                  >
                    <option value="DAILY_AQI">Daily AQI</option>
                    <option value="AQI">AQI</option>
                    <option value="PM">PM 2.5</option>
                  </select>
                  {aaqeDisplayType !== 'DAILY_AQI' && (
                    <>
                      <label style={{ fontSize: 12, color: '#666', fontWeight: 600, display: 'block', marginTop: 6 }}>
                        Time (UTC)
                      </label>
                      <select
                        className="site-select"
                        style={{ marginTop: 4 }}
                        value={aaqeTimeCode}
                        onChange={(e) => setAaqeTimeCode(e.target.value)}
                      >
                        {aaqeTimeOptions.map((t) => (
                          <option key={t.code} value={t.code}>{t.label}</option>
                        ))}
                      </select>
                    </>
                  )}
                </div>
              )}
              {showAAQEForecast && aaqeNotice && (
                <small className="layer-tip">{aaqeNotice}</small>
              )}
              {showAAQEForecast && aaqeError && (
                <small className="layer-tip layer-tip-warn">⚠ {aaqeError}</small>
              )}
                </>
              )}
            </div>
            </div>
          </aside>

          <main className="dashboard-map-area">
            {isCompactLayout && (
              <div className="dashboard-mobile-controls">
                <button
                  type="button"
                  className={`dashboard-mobile-btn${leftPanelOpen ? ' dashboard-mobile-btn--active' : ''}`}
                  onClick={() => {
                    setLeftPanelOpen((open) => {
                      const next = !open;
                      if (next) setRightPanelOpen(false);
                      return next;
                    });
                  }}
                >
                  Layers
                </button>
                {showRightPanel && (
                  <button
                    type="button"
                    className={`dashboard-mobile-btn${rightPanelOpen ? ' dashboard-mobile-btn--active' : ''}`}
                    onClick={() => {
                      setRightPanelOpen((open) => {
                        const next = !open;
                        if (next) setLeftPanelOpen(false);
                        return next;
                      });
                    }}
                  >
                    Data
                  </button>
                )}
              </div>
            )}
            {aeronetError && (
              <div className="aeronet-error-bar" role="alert">
                AERONET API Error: {aeronetError}
              </div>
            )}
            {showFires && fireLoading && (
              <div className="map-loading-overlay map-loading-overlay--bottom-right">
                <div className="spinner-border spinner-border-sm text-primary" role="status" aria-hidden="true" />
                <p className="map-loading-text map-loading-text--small">Loading fire…</p>
              </div>
            )}
            {showMERRA2PM25 && merra2ShowGridOverlay && merra2GridLoading && (
              <div className="map-loading-overlay map-loading-overlay--bottom-right" aria-live="polite">
                <div className="spinner-border spinner-border-sm text-primary" role="status" aria-hidden="true" />
                <p className="map-loading-text map-loading-text--small">Loading CNN PM2.5 grid…</p>
              </div>
            )}
            {showMERRA2PM25 && merra2ShowStations && merra2Loading && merra2Stations.length === 0 && (
              <div className="map-loading-overlay map-loading-overlay--bottom-right" aria-live="polite">
                <div className="spinner-border spinner-border-sm text-primary" role="status" aria-hidden="true" />
                <p className="map-loading-text map-loading-text--small">Loading MERRA2 stations…</p>
              </div>
            )}
            {showWashU && washuShowStations && washuStationsLoading && washuStations.length === 0 && (
              <div className="map-loading-overlay map-loading-overlay--bottom-right" aria-live="polite">
                <div className="spinner-border spinner-border-sm text-primary" role="status" aria-hidden="true" />
                <p className="map-loading-text map-loading-text--small">Loading WashU stations…</p>
              </div>
            )}
            {showWashU && washuShowGridOverlay && washuGridLoading && (
              <div className="map-loading-overlay map-loading-overlay--bottom-right" aria-live="polite">
                <div className="spinner-border spinner-border-sm text-primary" role="status" aria-hidden="true" />
                <p className="map-loading-text map-loading-text--small">Loading WashU SatPM2.5 grid…</p>
              </div>
            )}
            {showOpenAq && openAqLoading && openAqStations.length === 0 && (
              <div className="map-loading-overlay map-loading-overlay--bottom-right" aria-live="polite">
                <div className="spinner-border spinner-border-sm text-primary" role="status" aria-hidden="true" />
                <p className="map-loading-text map-loading-text--small">Loading OpenAQ stations…</p>
              </div>
            )}
            <div className="map-container">
              <MapVisualization
                firePoints={firePoints}
                aeronetSites={aeronetSites}
                siteAodMap={derivedSiteAodMap}
                showFires={showFires}
                showAeronet={showAeronet}
                showVIIRSImagery={showVIIRSImagery}
                showMERRA2PM25={showMERRA2PM25}
                showMerra2Stations={showMERRA2PM25 && merra2ShowStations}
                showMerra2GridOverlay={merra2ShowGridOverlay}
                merra2GridDate={merra2RequestedDate}
                merra2GridHour={merra2GridHour}
                onMerra2GridLoadingChange={setMerra2GridLoading}
                onMerra2GridSourceChange={(source, reason) => {
                  setMerra2GridSource(source);
                  setMerra2GridFallbackReason(reason ?? null);
                }}
                merra2GridSource={merra2GridSource}
                showWashU={showWashU}
                showWashuGridOverlay={washuShowGridOverlay}
                showWashuStations={washuShowStations}
                washuStations={washuStations}
                onWashuStationClick={handleWashuStationClick}
                washuPeriod={washuPeriod}
                washuYear={washuPeriodParts.year}
                washuMonth={washuPeriod === 'monthly' ? washuPeriodParts.month : null}
                washuPeriodLabel={washuPeriodLabel}
                onWashuGridLoadingChange={setWashuGridLoading}
                onWashuGridSourceChange={(source, reason) => {
                  setWashuGridSource(source);
                  setWashuGridFallbackReason(reason ?? null);
                }}
                washuGridSource={washuGridSource}
                onWashuMapClick={handleWashuMapClick}
                onWashuPm25Sample={(sample) => {
                  if (!sample) return;
                  setWashuPin((prev) => (prev ? { ...prev, pm25: sample.value } : prev));
                }}
                showAAQEForecast={showAAQEForecast}
                showOpenAq={showOpenAq}
                openAqStations={openAqStations}
                onOpenAqStationClick={handleOpenAqStationClick}
                selectedDate={selectedDateForMap}
                onFireClick={handleFireClick}
                onAeronetSiteClick={handleAeronetSiteClick}
                circleCenter={circleCenter}
                circleRadiusKm={circleRadiusKm}
                circleSelectActive={circleSelectActive}
                onCircleCenterChange={handleCircleCenterChange}
                onCircleClose={handleCircleClose}
                pointsInCircle={pointsInSelection}
                fireChartRectDrawActive={fireChartRectDrawActive}
                fireChartBounds={fireChartBounds}
                onFireChartBoundsCommit={handleFireChartBoundsCommit}
                merra2Stations={merra2Stations}
                onMerra2StationClick={handleMerra2StationClick}
                aaqeForecastPoints={aaqeForecastPoints}
                aaqeForecastTimeCode={aaqeTimeCode}
                aaqeDisplayType={aaqeDisplayType}
                aaqeForecastDate={aaqeForecastDate ?? undefined}
                onAAQEForecastClick={handleAAQEForecastClick}
              />

              {showAAQEForecast && activeSelectedAAQE && aaqeThreeDaySeries.length > 0 && (
                <div className="aaqe-modal-overlay" role="dialog" aria-label="AAQE 3-day forecast">
                  <div className="aaqe-modal-card">
                    <div className="aaqe-modal-header">
                      <h5>
                        {(activeSelectedAAQE.siteName ?? 'Forecast Site')} (African AQE) | 3-Day Forecast
                      </h5>
                      <button
                        type="button"
                        className="aaqe-modal-close"
                        onClick={() => setSelectedAAQE(null)}
                        aria-label="Close forecast modal"
                      >
                        ×
                      </button>
                    </div>
                    <div className="aaqe-modal-chart">
                      <Suspense fallback={<ChartLoadingFallback />}>
                        <AAQEThreeDayForecastChart points={aaqeThreeDaySeries} />
                      </Suspense>
                    </div>
                  </div>
                </div>
              )}

            </div>
            {showAeronet && selectedSite && (
              <div className="charts-section" style={{ paddingTop: 14 }}>
                <div
                  className="charts-section-header"
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12,
                    marginBottom: 8,
                  }}
                >
                  <h6 style={{ margin: 0 }}>Time Series Analysis</h6>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 13, lineHeight: '20px' }}>Analysis Range</span>
                    <select
                      className="site-select"
                      value={analysisRange}
                      onChange={(e) => setAnalysisRange(e.target.value as AnalysisRange)}
                      style={{
                        width: 160,
                        padding: '6px 10px',
                        margin: 0,
                        fontSize: 13,
                        lineHeight: '20px',
                        height: 32,
                      }}
                      aria-label="Analysis Range"
                    >
                      <option value="7D">Last 7 Days</option>
                      <option value="30D">Last 30 Days</option>
                      <option value="90D">Last 90 Days</option>
                    </select>
                    <button
                      type="button"
                      className="panel-close-btn"
                      onClick={() => setSelectedSite(null)}
                      aria-label="Close Analysis"
                    >
                      ×
                    </button>
                  </div>
                </div>
                <small className="layer-tip" style={{ marginTop: 2, display: 'block', textAlign: 'left' }}>
                  Showing: {analysisRangeLabel} ({formatDisplayDate(analysisStartDate)} – {formatDisplayDate(analysisEndDate)})
                </small>
                {chartLoading ? (
                  <div className="chart-loading-box">
                    <div className="chart-loading-spinner" />
                    <p className="chart-loading">
                      Loading AOD data for {selectedSite.name ?? selectedSite.site}…
                    </p>
                    <p className="chart-loading-hint">Updating charts and selected data panel</p>
                  </div>
                ) : (
                  <Suspense fallback={<ChartLoadingFallback />}>
                    <div className="charts-row" key={`${selectedSite?.site ?? 'charts'}-${analysisRange}`}>
                      <div className="chart-box">
                        <div className="chart-container" key={`ts-${selectedSite?.site ?? ''}`}>
                          <TimeSeriesChart
                            data={dailyMeanAod}
                            startDate={dayjs(analysisStartDate)}
                            endDate={dayjs(analysisEndDate)}
                          />
                        </div>
                      </div>
                      <div className="chart-box">
                        <div className="chart-container" key={`scatter-${selectedSite?.site ?? ''}`}>
                          <ScatterPlotChart data={dailyMeanAod} />
                        </div>
                      </div>
                      <div className="chart-box">
                        <div className="chart-container" key={`wavelength-${selectedSite?.site ?? ''}`}>
                          <WavelengthBarChart data={dailyMeanAod} />
                        </div>
                      </div>
                    </div>
                  </Suspense>
                )}
              </div>
            )}
            {showFires && (
              <div className="charts-section" style={{ paddingTop: 14 }}>
                <div
                  className="charts-section-header"
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12,
                    marginBottom: 8,
                  }}
                >
                  <h6 style={{ margin: 0 }}>Fire Hotspots Analysis</h6>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 13, lineHeight: '20px' }}>Analysis Range</span>
                    <select
                      className="site-select"
                      value={fireAnalysisRange}
                      onChange={(e) => setFireAnalysisRange(e.target.value as FireAnalysisRange)}
                      style={{
                        width: 160,
                        padding: '6px 10px',
                        margin: 0,
                        fontSize: 13,
                        lineHeight: '20px',
                        height: 32,
                      }}
                      aria-label="Fire Analysis Range"
                    >
                      <option value="24H">Last 24 Hours</option>
                      <option value="48H">Last 48 Hours</option>
                      <option value="7D">Last 7 Days</option>
                    </select>
                  </div>
                </div>
                <small className="layer-tip" style={{ marginTop: 2, display: 'block', textAlign: 'left' }}>
                  Showing: {fireRangeLabel} ({formatDisplayDate(fireRangeStart.format('YYYY-MM-DD'))} – {formatDisplayDate(fireRangeEnd.format('YYYY-MM-DD'))})
                </small>
                <p className="chart-subtitle" style={{ marginTop: 6 }}>
                  {fireChartBounds
                    ? 'Showing analysis for detections inside selected rectangle'
                    : 'Showing analysis for all loaded fire detections'}
                </p>
                <Suspense fallback={<ChartLoadingFallback />}>
                  <div
                    className="charts-row"
                    key={`fire-charts-${fireAnalysisRange}-${effectiveSelectedDateStr}-${
                      fireChartBounds
                        ? `${fireChartBounds.south.toFixed(2)}_${fireChartBounds.west.toFixed(2)}_${fireChartBounds.north.toFixed(2)}_${fireChartBounds.east.toFixed(2)}`
                        : 'all'
                    }`}
                  >
                    <div className="chart-box">
                      <div className="chart-container">
                        <FireCountTimeSeriesChart
                          dailyStats={fireDailyStats}
                          startDate={fireRangeStart.startOf('day')}
                          endDate={fireRangeEnd.startOf('day')}
                        />
                      </div>
                    </div>
                    <div className="chart-box">
                      <div className="chart-container">
                        <FireAverageFrpTimeSeriesChart
                          dailyStats={fireDailyStats}
                          startDate={fireRangeStart.startOf('day')}
                          endDate={fireRangeEnd.startOf('day')}
                        />
                      </div>
                    </div>
                    <div className="chart-box">
                      <div className="chart-container">
                        <FireBrightnessFrpScatterChart points={fireScatterPoints} />
                      </div>
                    </div>
                  </div>
                </Suspense>
              </div>
            )}
            {showMERRA2PM25 && selectedMerra2Station && (
              <div className="charts-section" style={{ paddingTop: 14 }}>
                <div
                  className="charts-section-header"
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12,
                    marginBottom: 8,
                  }}
                >
                  <h6 style={{ margin: 0 }}>MERRA2 CNN PM2.5 Analysis</h6>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <DatePicker
                      label="From"
                      value={merra2DateFrom}
                      onChange={(d) => d && setMerra2DateFrom(d)}
                      slotProps={{ textField: { size: 'small' } }}
                    />
                    <DatePicker
                      label="To"
                      value={merra2DateTo}
                      onChange={(d) => d && setMerra2DateTo(d)}
                      slotProps={{ textField: { size: 'small' } }}
                    />
                    <button
                      type="button"
                      className="export-csv-btn"
                      style={{ marginTop: 0, height: 40, padding: '0 14px' }}
                      onClick={applyMerra2Range}
                    >
                      Apply
                    </button>
                    <button
                      type="button"
                      className="export-csv-btn"
                      style={{ marginTop: 0, height: 40, padding: '0 14px' }}
                      onClick={resetMerra2Range}
                    >
                      Reset
                    </button>
                  </div>
                </div>
                <small className="layer-tip" style={{ marginTop: 2, display: 'block', textAlign: 'left' }}>
                  Station: {selectedMerra2Station.sitename} · Showing {merra2AnalysisStartDate} to {merra2AnalysisEndDate}
                </small>
                {merra2SeriesLoading ? (
                  <div className="chart-loading-box">
                    <div className="chart-loading-spinner" />
                    <p className="chart-loading">Loading PM2.5 series for {selectedMerra2Station.sitename}…</p>
                  </div>
                ) : (
                  <Suspense fallback={<ChartLoadingFallback />}>
                    <div className="charts-row">
                      <div className="chart-box" style={{ minWidth: 380 }}>
                        <div className="chart-container">
                          <MERRA2StationTimeSeriesChart
                            points={merra2Series}
                            startDate={dayjs(merra2AnalysisStartDate)}
                            endDate={dayjs(merra2AnalysisEndDate)}
                          />
                        </div>
                      </div>
                    </div>
                  </Suspense>
                )}
              </div>
            )}
            {showWashU && selectedWashuStation && (
              <div className="charts-section" style={{ paddingTop: 14 }}>
                <div
                  className="charts-section-header"
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12,
                    marginBottom: 8,
                  }}
                >
                  <h6 style={{ margin: 0 }}>WashU SatPM2.5 station analysis</h6>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <select
                      className="site-select"
                      style={{ minWidth: 110 }}
                      value={washuStationSeriesGranularity}
                      onChange={(e) => setWashuStationSeriesGranularity(e.target.value as 'monthly' | 'annual')}
                    >
                      <option value="monthly">Monthly</option>
                      <option value="annual">Annual</option>
                    </select>
                    <label style={{ fontSize: 12, color: '#666', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      From
                      <input
                        type="number"
                        min={1998}
                        max={2023}
                        value={washuStationSeriesStartYear}
                        onChange={(e) => setWashuStationSeriesStartYear(Number(e.target.value))}
                        style={{ width: 72, padding: '5px 8px', borderRadius: 4, border: '1px solid #ddd' }}
                      />
                      {washuStationSeriesGranularity === 'monthly' && (
                        <>
                          /
                          <input
                            type="number"
                            min={1}
                            max={12}
                            value={washuStationSeriesStartMonth}
                            onChange={(e) => setWashuStationSeriesStartMonth(Number(e.target.value))}
                            style={{ width: 52, padding: '5px 8px', borderRadius: 4, border: '1px solid #ddd' }}
                          />
                        </>
                      )}
                    </label>
                    <label style={{ fontSize: 12, color: '#666', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      To
                      <input
                        type="number"
                        min={1998}
                        max={2023}
                        value={washuStationSeriesEndYear}
                        onChange={(e) => setWashuStationSeriesEndYear(Number(e.target.value))}
                        style={{ width: 72, padding: '5px 8px', borderRadius: 4, border: '1px solid #ddd' }}
                      />
                      {washuStationSeriesGranularity === 'monthly' && (
                        <>
                          /
                          <input
                            type="number"
                            min={1}
                            max={12}
                            value={washuStationSeriesEndMonth}
                            onChange={(e) => setWashuStationSeriesEndMonth(Number(e.target.value))}
                            style={{ width: 52, padding: '5px 8px', borderRadius: 4, border: '1px solid #ddd' }}
                          />
                        </>
                      )}
                    </label>
                    <button
                      type="button"
                      className="export-csv-btn"
                      style={{ marginTop: 0, height: 40, padding: '0 14px' }}
                      onClick={applyWashuStationRange}
                    >
                      Apply
                    </button>
                    <button
                      type="button"
                      className="export-csv-btn"
                      style={{ marginTop: 0, height: 40, padding: '0 14px' }}
                      onClick={resetWashuStationRange}
                    >
                      Reset
                    </button>
                  </div>
                </div>
                <small className="layer-tip" style={{ marginTop: 2, display: 'block', textAlign: 'left' }}>
                  Station: {selectedWashuStation.sitename} · {washuStationAppliedSeriesRange.granularity === 'annual'
                    ? `${washuStationAppliedSeriesRange.startYear}–${washuStationAppliedSeriesRange.endYear} (annual means)`
                    : `${washuStationAppliedSeriesRange.startYear}-${String(washuStationAppliedSeriesRange.startMonth).padStart(2, '0')} to ${washuStationAppliedSeriesRange.endYear}-${String(washuStationAppliedSeriesRange.endMonth).padStart(2, '0')} (monthly means)`}
                </small>
                {washuStationSeriesLoading ? (
                  <div className="chart-loading-box">
                    <div className="chart-loading-spinner" />
                    <p className="chart-loading">Loading WashU PM2.5 series for {selectedWashuStation.sitename}…</p>
                  </div>
                ) : (
                  <Suspense fallback={<ChartLoadingFallback />}>
                    <div className="charts-row">
                      <div className="chart-box" style={{ minWidth: 380 }}>
                        <div className="chart-container">
                          <WashUTimeSeriesChart
                            points={washuStationSeries}
                            startYear={washuStationAppliedSeriesRange.startYear}
                            startMonth={washuStationAppliedSeriesRange.startMonth}
                            endYear={washuStationAppliedSeriesRange.endYear}
                            endMonth={washuStationAppliedSeriesRange.endMonth}
                            granularity={washuStationAppliedSeriesRange.granularity}
                            title={
                              washuStationAppliedSeriesRange.granularity === 'annual'
                                ? `WashU SatPM2.5 Annual Mean · ${selectedWashuStation.sitename}`
                                : `WashU SatPM2.5 Monthly Mean · ${selectedWashuStation.sitename}`
                            }
                            emptyMessage=" Adjust the range and click Apply."
                          />
                        </div>
                      </div>
                    </div>
                  </Suspense>
                )}
              </div>
            )}
            {showWashU && washuPin && (
              <div className="charts-section" style={{ paddingTop: 14 }}>
                <div
                  className="charts-section-header"
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12,
                    marginBottom: 8,
                    flexWrap: 'wrap',
                  }}
                >
                  <h6 style={{ margin: 0 }}>WashU monthly PM2.5 time series</h6>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <label style={{ fontSize: 12, color: '#666', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      From
                      <input
                        type="number"
                        min={1998}
                        max={2023}
                        value={washuSeriesStartYear}
                        onChange={(e) => setWashuSeriesStartYear(Number(e.target.value))}
                        style={{ width: 72, padding: '5px 8px', borderRadius: 4, border: '1px solid #ddd' }}
                      />
                      /
                      <input
                        type="number"
                        min={1}
                        max={12}
                        value={washuSeriesStartMonth}
                        onChange={(e) => setWashuSeriesStartMonth(Number(e.target.value))}
                        style={{ width: 52, padding: '5px 8px', borderRadius: 4, border: '1px solid #ddd' }}
                      />
                    </label>
                    <label style={{ fontSize: 12, color: '#666', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      To
                      <input
                        type="number"
                        min={1998}
                        max={2023}
                        value={washuSeriesEndYear}
                        onChange={(e) => setWashuSeriesEndYear(Number(e.target.value))}
                        style={{ width: 72, padding: '5px 8px', borderRadius: 4, border: '1px solid #ddd' }}
                      />
                      /
                      <input
                        type="number"
                        min={1}
                        max={12}
                        value={washuSeriesEndMonth}
                        onChange={(e) => setWashuSeriesEndMonth(Number(e.target.value))}
                        style={{ width: 52, padding: '5px 8px', borderRadius: 4, border: '1px solid #ddd' }}
                      />
                    </label>
                    <button type="button" className="export-csv-btn" style={{ marginTop: 0 }} onClick={applyWashuSeriesRange}>
                      Apply
                    </button>
                  </div>
                </div>
                <small className="layer-tip" style={{ marginTop: 2, display: 'block', textAlign: 'left' }}>
                  Location: {washuPin.lat.toFixed(3)}°, {washuPin.lon.toFixed(3)}° · Monthly files from ACAG SatPM V6.GL.03
                  (Africa).
                </small>
                {washuSeriesError && (
                  <small className="layer-tip layer-tip-warn" style={{ display: 'block' }}>
                    ⚠ {washuSeriesError}
                  </small>
                )}
                {washuSeriesLoading ? (
                  <div className="chart-loading-box">
                    <div className="chart-loading-spinner" />
                    <p className="chart-loading">
                      Loading WashU monthly series… First request may download NetCDF files from AWS (one per month).
                    </p>
                  </div>
                ) : (
                  <Suspense fallback={<ChartLoadingFallback />}>
                    <div className="charts-row">
                      <div className="chart-box" style={{ minWidth: 380 }}>
                        <div className="chart-container">
                          <WashUTimeSeriesChart
                            points={washuSeries}
                            startYear={washuAppliedSeriesRange.startYear}
                            startMonth={washuAppliedSeriesRange.startMonth}
                            endYear={washuAppliedSeriesRange.endYear}
                            endMonth={washuAppliedSeriesRange.endMonth}
                            title={`WashU PM2.5 · ${washuPin.lat.toFixed(2)}°, ${washuPin.lon.toFixed(2)}°`}
                          />
                        </div>
                      </div>
                    </div>
                  </Suspense>
                )}
              </div>
            )}
            {showOpenAq && selectedOpenAqStation && workflow === 'historical' && (
              <div className="charts-section" style={{ paddingTop: 14 }}>
                <div
                  className="charts-section-header"
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12,
                    marginBottom: 8,
                  }}
                >
                  <h6 style={{ margin: 0 }}>OpenAQ Ground PM2.5 Analysis</h6>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <DatePicker
                      label="From"
                      value={openAqDateFrom}
                      onChange={(d) => d && setOpenAqDateFrom(d)}
                      slotProps={{ textField: { size: 'small' } }}
                    />
                    <DatePicker
                      label="To"
                      value={openAqDateTo}
                      onChange={(d) => d && setOpenAqDateTo(d)}
                      slotProps={{ textField: { size: 'small' } }}
                    />
                    <button
                      type="button"
                      className="export-csv-btn"
                      style={{ marginTop: 0, height: 40, padding: '0 14px' }}
                      onClick={applyOpenAqRange}
                    >
                      Apply
                    </button>
                    <button
                      type="button"
                      className="export-csv-btn"
                      style={{ marginTop: 0, height: 40, padding: '0 14px' }}
                      onClick={resetOpenAqRange}
                    >
                      Reset
                    </button>
                  </div>
                </div>
                <small className="layer-tip" style={{ marginTop: 2, display: 'block', textAlign: 'left' }}>
                  Station: {selectedOpenAqStation.name} · Showing {openAqAnalysisStartDate} to {openAqAnalysisEndDate}
                  {openAqSeriesLoading ? ' · Loading history…' : ''}
                </small>
                {openAqChartDisplayPoints.length === 0 && openAqSeriesLoading ? (
                  <div className="chart-loading-box">
                    <div className="chart-loading-spinner" />
                    <p className="chart-loading">Loading OpenAQ series for {selectedOpenAqStation.name}…</p>
                  </div>
                ) : (
                  <Suspense fallback={<ChartLoadingFallback />}>
                    <div className="charts-row">
                      <div className="chart-box" style={{ minWidth: 380 }}>
                        <div className="chart-container">
                          <OpenAqTimeSeriesChart
                            points={openAqChartDisplayPoints}
                            startDate={dayjs(openAqAnalysisStartDate)}
                            endDate={dayjs(openAqAnalysisEndDate)}
                          />
                        </div>
                      </div>
                    </div>
                    {openAqSeriesError && openAqSeries.length === 0 && (
                      <small className="layer-tip layer-tip-warn" style={{ display: 'block', marginTop: 8 }}>
                        Could not load full PM2.5 history ({openAqSeriesError}).
                        {openAqChartDisplayPoints.length > 0
                          ? ' Showing the map reading while history is unavailable.'
                          : ''}
                      </small>
                    )}
                    {openAqSeries.length === 0 && !openAqSeriesLoading && openAqChartDisplayPoints.length === 0 && (
                      <small className="layer-tip layer-tip-warn" style={{ display: 'block', marginTop: 8 }}>
                        {openAqSeriesError
                          ? `Could not load PM2.5 history (${openAqSeriesError}). `
                          : 'No PM2.5 history in this date range. '}
                        {!openAqSeriesError
                          && (selectedOpenAqStation.datetime?.slice(0, 10)
                          ?? selectedOpenAqStation.datetimeLast?.slice(0, 10)) && (
                          <>
                            This station&apos;s last OpenAQ reading was on{' '}
                            {formatDateMonthDayYear(
                              selectedOpenAqStation.datetime?.slice(0, 10)
                                ?? selectedOpenAqStation.datetimeLast!.slice(0, 10)
                            )}
                            . Click Reset or pick dates on or before that day.
                          </>
                        )}
                      </small>
                    )}
                  </Suspense>
                )}
              </div>
            )}
          </main>

          {!rightPanelOpen && showRightPanel && !isCompactLayout && (
            <button
              type="button"
              className="panel-reopen-btn"
              onClick={() => setRightPanelOpen(true)}
              title="Show Selected Data"
            >
              ◀
            </button>
          )}
          {rightPanelOpen && showRightPanel && (
            <aside
              className={`dashboard-sidebar-right${isCompactLayout ? ' dashboard-sidebar-drawer dashboard-sidebar-drawer--right is-open' : ''}`}
            >
              <div className="selected-data-panel">
                <div className="selected-data-header-row">
                  <h5>
                    Selected Data
                    {activeSelectedSite && chartLoading && (
                      <span className="data-updating-badge"> Updating…</span>
                    )}
                  </h5>
                  <button
                    type="button"
                    className="panel-close-btn"
                    onClick={() => setRightPanelOpen(false)}
                    aria-label="Close panel"
                  >
                    ×
                  </button>
                </div>
                {activeSelectedSite ? (
                  <div className="selected-site-details">
                    <p className="data-source">AERONET Site</p>
                    <table className="selected-data-table">
                      <tbody>
                        <tr><td>NAME</td><td>{activeSelectedSite.name ?? activeSelectedSite.site}</td></tr>
                        <tr><td>SITE ID</td><td>{activeSelectedSite.site}</td></tr>
                        <tr><td>DATE RANGE</td><td>{formatDateMonthDayYear(aeronetStart.format('YYYY-MM-DD'))} – {formatDateMonthDayYear(aeronetEnd.format('YYYY-MM-DD'))}</td></tr>
                        <tr><td>LAT / LON</td><td className="coord-cell">{(activeSelectedSite.latitude ?? 0).toFixed(2)}, {(activeSelectedSite.longitude ?? 0).toFixed(2)}</td></tr>
                        {activeSelectedSite.elevation != null && (
                          <tr><td>ELEVATION</td><td>{activeSelectedSite.elevation.toFixed(0)} m</td></tr>
                        )}
                        {!chartLoading && (() => {
                          const data = chartData ?? [];
                          if (data.length === 0) {
                            return (
                              <>
                                <tr><td>DATA RANGE</td><td>—</td></tr>
                                <tr><td>AOD 500nm</td><td>—</td></tr>
                                <tr><td>AOD 675nm</td><td>—</td></tr>
                                <tr><td>AOD 870nm</td><td>—</td></tr>
                                <tr><td>AOD 1020nm</td><td>—</td></tr>
                              </>
                            );
                          }
                          const dailyMean = computeDailyMeanAOD(data);
                          const latest = dailyMean.length > 0 ? dailyMean[dailyMean.length - 1] : data[data.length - 1];
                          const avg = (arr: (number | undefined)[]) => {
                            const v = arr.filter((x) => x != null && !isNaN(x)) as number[];
                            return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(2) : '—';
                          };
                          const fmt = (n: number | undefined) => (n != null && !isNaN(n) ? n.toFixed(2) : '—');
                          const AODCell = ({ val }: { val: number | undefined }) => {
                            const level = getAODLevelLabel(val);
                            return (
                              <span>
                                <span style={{ color: getAODLevelColor(val), fontWeight: 600 }}>{fmt(val)}</span>
                                {level && <span className="aod-level-badge" style={{ marginLeft: 6, fontSize: 11, color: getAODLevelColor(val) }}>({level})</span>}
                              </span>
                            );
                          };
                          const firstIso = normalizeAeronetDate(data[0]?.date);
                          const lastIso = normalizeAeronetDate(data[data.length - 1]?.date);
                          return (
                            <>
                              <tr><td>DATA RANGE</td><td className="date-range-cell">{formatDateMonthDayYear(firstIso)} - {formatDateMonthDayYear(lastIso)}</td></tr>
                              <tr><td>AOD 500nm</td><td className="aod-value-cell"><AODCell val={latest.AOD_500nm} /><span className="aod-avg">avg {avg(dailyMean.map((d) => d.AOD_500nm))}</span></td></tr>
                              <tr><td>AOD 675nm</td><td className="aod-value-cell"><AODCell val={latest.AOD_675nm} /><span className="aod-avg">avg {avg(dailyMean.map((d) => d.AOD_675nm))}</span></td></tr>
                              <tr><td>AOD 870nm</td><td className="aod-value-cell"><AODCell val={latest.AOD_870nm} /><span className="aod-avg">avg {avg(dailyMean.map((d) => d.AOD_870nm))}</span></td></tr>
                              <tr><td>AOD 1020nm</td><td className="aod-value-cell"><AODCell val={latest.AOD_1020nm} /><span className="aod-avg">avg {avg(dailyMean.map((d) => d.AOD_1020nm))}</span></td></tr>
                              <tr><td>MEASUREMENTS</td><td className="nowrap-cell">{data.length} (daily mean: {dailyMean.length} days)</td></tr>
                            </>
                          );
                        })()}
                        {chartLoading && (
                          <tr><td>DATA</td><td>Loading...</td></tr>
                        )}
                      </tbody>
                    </table>
                    {activeSelectedSite && chartData.length > 0 && (
                      <>
                        <button type="button" className="export-csv-btn" onClick={exportAODCSV}>
                          Export CSV
                        </button>
                        <p className="data-source-footer">AOD time series and wavelength charts below</p>
                      </>
                    )}
                  </div>
                ) : activeSelectedFire ? (
                  <div className="selected-fire-details">
                    <p className="data-source">VIIRS / NOAA-21 [375m]</p>
                    <table className="selected-data-table">
                      <tbody>
                        <tr><td>LATITUDE</td><td>{activeSelectedFire.latitude.toFixed(5)}</td></tr>
                        <tr><td>LONGITUDE</td><td>{activeSelectedFire.longitude.toFixed(5)}</td></tr>
                        <tr><td>BRIGHT_TI4</td><td>{activeSelectedFire.bright_ti4.toFixed(2)}</td></tr>
                        <tr><td>BRIGHT_TI5</td><td>{(activeSelectedFire.bright_ti5 ?? 0).toFixed(2)}</td></tr>
                        <tr><td>SCAN</td><td>{activeSelectedFire.scan}</td></tr>
                        <tr><td>TRACK</td><td>{activeSelectedFire.track}</td></tr>
                        <tr><td>ACQUIRE TIME</td><td>{activeSelectedFire.acq_date} {activeSelectedFire.acq_time}</td></tr>
                        <tr><td>SATELLITE</td><td>{activeSelectedFire.satellite}</td></tr>
                        <tr><td>INSTRUMENT</td><td>{activeSelectedFire.instrument}</td></tr>
                        <tr><td>CONFIDENCE</td><td>{activeSelectedFire.confidence || 'nominal'}</td></tr>
                        <tr><td>VERSION</td><td>{activeSelectedFire.version || '2.0NRT'}</td></tr>
                        <tr><td>FRP</td><td>{activeSelectedFire.frp?.toFixed(2) ?? 'N/A'}</td></tr>
                        <tr><td>DAYNIGHT</td><td>{activeSelectedFire.daynight === 'D' ? 'D' : activeSelectedFire.daynight === 'N' ? 'N' : activeSelectedFire.daynight}</td></tr>
                      </tbody>
                    </table>
                    <p className="data-source-footer">Source: NASA FIRMS (VIIRS NOAA-21)</p>
                  </div>
                ) : activeSelectedMerra2Station ? (
                  <Merra2SelectedPanel
                    station={activeSelectedMerra2Station}
                    aqi={selectedMerra2Aqi}
                    dataDate={merra2PanelDataDate}
                    metricsLoading={merra2PanelMetricsLoading}
                  />
                ) : activeSelectedWashuStation ? (
                  <WashuStationSelectedPanel
                    station={activeSelectedWashuStation}
                    aqi={selectedWashuStationAqi}
                    dataDate={washuPanelDataDate}
                    metricsLoading={washuPanelMetricsLoading}
                  />
                ) : washuPin ? (
                  <WashUSelectedPanel
                    lat={washuPin.lat}
                    lon={washuPin.lon}
                    periodLabel={washuPeriodLabel}
                    pm25={washuPin.pm25}
                    loading={washuGridLoading}
                  />
                ) : activeSelectedOpenAq ? (
                  <OpenAqSelectedPanel
                    station={selectedOpenAqPanelStation ?? activeSelectedOpenAq}
                    aqi={selectedOpenAqAqi}
                    dataDate={
                      openAqMapMode === 'daily'
                        ? effectiveSelectedDateStr
                        : (
                            activeSelectedOpenAq.datetime?.slice(0, 10) ||
                            activeSelectedOpenAq.datetimeLast?.slice(0, 10) ||
                            effectiveSelectedDateStr
                          )
                    }
                    metricsLoading={
                      (openAqLoading || openAqSeriesLoading)
                      && !hasOpenAqPm25Value(activeSelectedOpenAq)
                      && !selectedOpenAqDayPoint
                    }
                  />
                ) : activeSelectedAAQE ? (
                  <AaqeSelectedPanel data={activeSelectedAAQE} threeDayRows={aaqeThreeDayRows} />
                ) : !analysisAnchor ? (
                  <p className="text-muted">Click a marker on the map or select a site from the left sidebar to view data.</p>
                ) : null}

                {analysisAnchor && (
                  <Suspense fallback={<ChartLoadingFallback />}>
                    <AnalysisPanel
                      location={analysisAnchor}
                      startDate={analysisStartDate}
                      endDate={analysisEndDate}
                      aeronetAodVersion={aeronetAodVersion}
                      analysisRange={analysisRange}
                      onAnalysisRangeChange={setAnalysisRange}
                      onClearAnchor={clearAnalysisAnchor}
                      preloadedStations={merra2Stations}
                    />
                  </Suspense>
                )}
              </div>
            </aside>
          )}
        </div>
      </div>
  );
};

export default DashboardPage;
