import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import dayjs from 'dayjs';
import MapVisualization from '../components/maps/MapVisualization';
import { getNOAA21VIIRS7DayFromWFS } from '../services/firmsApi';
import {
  getAfricanAERONETSites,
  getAERONETData,
  getAERONETDataAfrica,
  type AERONETDataPoint,
  type SiteAODMap,
  type AERONETAODVersion,
} from '../services/aeronetApi';
import type { FIRMSFirePoint } from '../services/firmsApi';
import type { AERONETSite } from '../services/aeronetApi';
import ChartLoadingFallback from '../components/charts/ChartLoadingFallback';

const TimeSeriesChart = lazy(() => import('../components/charts/TimeSeriesChart'));
const ScatterPlotChart = lazy(() => import('../components/charts/ScatterPlotChart'));
const WavelengthBarChart = lazy(() => import('../components/charts/WavelengthBarChart'));
const FireCountTimeSeriesChart = lazy(() => import('../components/charts/FireCountTimeSeriesChart'));
const FireAverageFrpTimeSeriesChart = lazy(() => import('../components/charts/FireAverageFrpTimeSeriesChart'));
const FireBrightnessFrpScatterChart = lazy(() => import('../components/charts/FireBrightnessFrpScatterChart'));
const MERRA2StationTimeSeriesChart = lazy(() => import('../components/charts/MERRA2StationTimeSeriesChart'));
const AAQEThreeDayForecastChart = lazy(() => import('../components/charts/AAQEThreeDayForecastChart'));
const AnalysisPanel = lazy(() => import('../components/analysis/AnalysisPanel'));
import { normalizeAeronetDate, formatDateMonthDayYear, formatDisplayDate } from '../utils/dateFormat';
import { computeDailyMeanAOD, getAODLevelColor, getAODLevelLabel, AOD_CLASSIFICATION_LEGEND } from '../utils/aodUtils';
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
import './DashboardPage.css';

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

const DashboardPage = () => {
  const [selectedDate, setSelectedDate] = useState(dayjs());
  const [selectedFire, setSelectedFire] = useState<SelectedFireData | null>(null);
  const [firePoints, setFirePoints] = useState<FIRMSFirePoint[]>([]);
  const [aeronetSites, setAeronetSites] = useState<AERONETSite[]>([]);
  type LayerMode = 'aeronet' | 'fires' | 'viirs' | 'merra2' | 'aaqe';
  const [activeLayer, setActiveLayer] = useState<LayerMode>('aeronet');
  const showAeronet = activeLayer === 'aeronet';
  const showFires = activeLayer === 'fires';
  const showVIIRSImagery = activeLayer === 'viirs';
  const showMERRA2PM25 = activeLayer === 'merra2';
  const showAAQEForecast = activeLayer === 'aaqe';
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
  const [aeronetLoading, setAeronetLoading] = useState(false);
  const [aeronetError, setAeronetError] = useState<string | null>(null);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [selectedSite, setSelectedSite] = useState<AERONETSite | null>(null);
  /** Persists across map layer switches; drives cross-layer Analysis panel. */
  const [analysisAnchor, setAnalysisAnchor] = useState<AnalysisLocationContext | null>(null);
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
    // Cap end at today — never request data beyond what's available.
    const today = dayjs().startOf('day');
    const requested = dayjs(selectedDateStr, 'YYYY-MM-DD').startOf('day');
    const end = requested.isAfter(today) ? today : requested;
    const days = range === '7D' ? 7 : range === '30D' ? 30 : 90;
    const start = end.subtract(days - 1, 'day');
    return { startDate: start.format('YYYY-MM-DD'), endDate: end.format('YYYY-MM-DD') };
  };

  const effectiveSelectedDate = selectedDate.isAfter(dayjs(), 'day') ? dayjs() : selectedDate;
  const effectiveSelectedDateStr = effectiveSelectedDate.format('YYYY-MM-DD');
  const merra2DefaultLatestDate = '2025-12-31';
  const merra2RequestedDate = useMemo(() => {
    const maxSupported = dayjs(merra2DefaultLatestDate);
    return effectiveSelectedDate.isAfter(maxSupported, 'day')
      ? merra2DefaultLatestDate
      : effectiveSelectedDateStr;
  }, [effectiveSelectedDate, effectiveSelectedDateStr]);
  const { startDate: analysisStartDate, endDate: analysisEndDate } = getDateRange(effectiveSelectedDateStr, analysisRange);
  const merra2AnalysisStartDate = merra2AppliedRange.start;
  const merra2AnalysisEndDate = merra2AppliedRange.end;
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

  // Anchor fire analysis windows to the freshest loaded FIRMS timestamp.
  // This avoids empty/non-updating 24h/48h charts when the date picker differs from feed recency.
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

  // Keep a consistent rolling AERONET window based on the selected date.
  // When the user picks a date, we automatically set:
  // - "To" = selected date
  // - "From" = 7 days prior
  useEffect(() => {
    setAeronetDateTo(selectedDate);
    setAeronetDateFrom(selectedDate.subtract(7, 'day'));
  }, [selectedDate]);

  // Fire hotspots: prefetch immediately on open (FIRMS is cached 15 min).
  useEffect(() => {
    let cancelled = false;
    setFireLoading(true);
    getNOAA21VIIRS7DayFromWFS()
      .then((pts) => { if (!cancelled) setFirePoints(pts); })
      .finally(() => { if (!cancelled) setFireLoading(false); });
    return () => { cancelled = true; };
  }, [selectedDate]);

  useEffect(() => {
    setAaqeTimeCode(getDefaultAaqeTimeCodeFromUtc());
  }, []);

  // AAQE forecast: delayed prefetch so AERONET (same NASA API) gets priority.
  useEffect(() => {
    const requested = selectedDate.isAfter(dayjs(), 'day')
      ? dayjs().format('YYYY-MM-DD')
      : selectedDate.format('YYYY-MM-DD');

    let cancelled = false;
    // Short delay so AERONET site list gets a head-start (AAQE is now cached after first load).
    const startTimer = window.setTimeout(() => {
      if (cancelled) return;
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
        const resolveForTarget = (target: string): AAQEForecastPoint[] => {
          for (const pool of pools) {
            const hit = filterPointsByUtcDate(pool, target);
            if (hit.length > 0) return hit;
          }
          return [];
        };
        const byDateFinal: Record<string, AAQEForecastPoint[]> = {};
        for (const { iso } of forecastDays) {
          let pts = resolveForTarget(iso);
          if (pts.length === 0) {
            try {
              pts = await getAAQEForecastByDate(iso);
            } catch {
              pts = [];
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
    }, 1000); // 1 s delay — lets AERONET get a head-start; GeoJSON is cached after first load

    return () => {
      cancelled = true;
      window.clearTimeout(startTimer);
    };
  }, [selectedDate]);

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

  // AERONET AOD map colors: prefetch for active date (slight debounce).
  useEffect(() => {
    const day = aeronetEnd.format('YYYY-MM-DD');
    let cancelled = false;
    const t = window.setTimeout(() => {
      getAERONETDataAfrica(day, day, aeronetAodVersion).then((map) => {
        if (!cancelled) setSiteAodMap(map);
      });
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [aeronetEnd, aeronetAodVersion]);

  const handleMerra2StationClick = useCallback((station: MERRA2StationDailyRecord) => {
    setSelectedMerra2Station(station);
    setSelectedSite(null);
    setSelectedFire(null);
    setSelectedAAQE(null);
    setAnalysisAnchor(anchorFromMerra2(station));
    setChartData([]);
    setRightPanelOpen(true);
  }, []);

  // AERONET site list: load on open, cached after first load.
  useEffect(() => {
    if (aeronetSites.length > 0) return; // already loaded
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

  // MERRA2 stations: prefetch on open and when date changes.
  useEffect(() => {
    let cancelled = false;
    const loadStations = async () => {
      setMerra2Loading(true);
      setMerra2Error(null);
      setMerra2Notice(null);
      const requestedDate = merra2RequestedDate;

      // Try selected date first so map points respond to date picker changes.
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

      // Fallback to latest available parquet date.
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
  }, [merra2RequestedDate, merra2LatestDate]);

  useEffect(() => {
    const endBase = dayjs(merra2DataDate ?? merra2RequestedDate, 'YYYY-MM-DD');
    const nextTo = endBase;
    const nextFrom = endBase.subtract(6, 'day');
    setMerra2DateFrom(nextFrom);
    setMerra2DateTo(nextTo);
    setMerra2AppliedRange({
      start: nextFrom.format('YYYY-MM-DD'),
      end: nextTo.format('YYYY-MM-DD'),
    });
  }, [merra2DataDate, merra2RequestedDate, selectedMerra2Station?.sitename]);

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
    setSelectedAAQE(null);
    setAnalysisAnchor(anchorFromAeronet(site));
    setChartData([]);
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
    setSelectedAAQE(null);
    setChartData([]);
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
    setSelectedFire(null);
    setChartData([]);
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

  const switchLayer = useCallback((next: LayerMode) => {
    setActiveLayer((prev) => {
      if (prev === next) return prev;
      if (prev === 'fires') {
        setCircleSelectActive(false);
        setCircleCenter(null);
        setFireChartRectDrawActive(false);
        setFireChartBounds(null);
      }
      return next;
    });
  }, []);

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
    const endBase = dayjs(merra2DataDate ?? merra2RequestedDate, 'YYYY-MM-DD');
    const nextTo = endBase;
    const nextFrom = endBase.subtract(6, 'day');
    setMerra2DateFrom(nextFrom);
    setMerra2DateTo(nextTo);
    setMerra2AppliedRange({
      start: nextFrom.format('YYYY-MM-DD'),
      end: nextTo.format('YYYY-MM-DD'),
    });
  }, [merra2DataDate, merra2RequestedDate]);

  const activeSelectedSite = showAeronet ? selectedSite : null;
  const activeSelectedFire = showFires ? selectedFire : null;
  const activeSelectedMerra2Station = showMERRA2PM25 ? selectedMerra2Station : null;
  const activeSelectedAAQE = showAAQEForecast ? selectedAAQE : null;
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
  const selectedMerra2AqiCategory = getAqiCategory(selectedMerra2Aqi);
  const hasMapSelection = Boolean(
    selectedSite || selectedFire || selectedMerra2Station || selectedAAQE
  );
  const showRightPanel = hasMapSelection || analysisAnchor != null;

  return (
    <div className="dashboard-page">
        <div className="dashboard-layout">
          {/* Left sidebar - Date & Data Layers */}
          <aside className="dashboard-sidebar-left">
            <div className="sidebar-section">
              <h6>Date Selection</h6>
              <DatePicker
                label="Select Date:"
                value={selectedDate}
                onChange={(d) => d && setSelectedDate(d)}
                slotProps={{ textField: { size: 'small', fullWidth: true } }}
              />
            </div>
            <div className="sidebar-section">
              <h6>Data Layers</h6>
              <label className="layer-checkbox">
                <input
                  type="checkbox"
                  checked={activeLayer === 'aeronet'}
                  onChange={() => switchLayer('aeronet')}
                />
                AERONET Sites {aeronetLoading && '(loading…)'}
              </label>
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
              <label className="layer-checkbox">
                <input
                  type="checkbox"
                  checked={activeLayer === 'fires'}
                  onChange={() => switchLayer('fires')}
                />
                Fire Hotspots (VIIRS) {fireLoading && '(loading…)'}
              </label>
              {showFires && (
                <>
                  <label className="layer-checkbox fire-subcontrol">
                    <input
                      type="checkbox"
                      checked={fireChartRectDrawActive}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setFireChartRectDrawActive(checked);
                      }}
                    />
                    Filter fire charts by rectangle (drag on map)
                  </label>
                  {fireChartRectDrawActive && (
                    <small className="layer-tip" style={{ marginTop: -4 }}>
                      Click and drag on the map to set the chart region.
                    </small>
                  )}
                  {fireChartBounds && (
                    <button type="button" className="export-csv-btn" style={{ marginTop: 6 }} onClick={clearFireChartRectangle}>
                      Clear chart rectangle
                    </button>
                  )}
                </>
              )}
              <label className="layer-checkbox">
                <input
                  type="checkbox"
                  checked={activeLayer === 'viirs'}
                  onChange={() => switchLayer('viirs')}
                />
                VIIRS Imagery
              </label>
              {showVIIRSImagery && (
                <small className="layer-tip">NASA GIBS · True Color (S-NPP) · Uses selected date</small>
              )}
              <label className="layer-checkbox">
                <input
                  type="checkbox"
                  checked={activeLayer === 'merra2'}
                  onChange={() => switchLayer('merra2')}
                />
                MERRA2 CNN PM2.5 {merra2Loading && '(loading…)'}
              </label>
              <label className="layer-checkbox">
                <input
                  type="checkbox"
                  checked={activeLayer === 'aaqe'}
                  onChange={() => switchLayer('aaqe')}
                />
                AAQE PM2.5 Forecast {aaqeLoading && '(loading…)'}
              </label>
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
              {showMERRA2PM25 && (
                <>
                  {merra2Error && <small className="layer-tip layer-tip-warn">⚠ {merra2Error}</small>}
                  {merra2Notice && <small className="layer-tip">{merra2Notice}</small>}
                  <div className="merra2-classification-legend">
                    <strong>MERRA2 PM2.5 AQI:</strong>
                    <ul>
                      <li>
                        <span className="aod-legend-swatch" style={{ backgroundColor: '#00e400' }} />
                        0-50 {'->'} Good
                      </li>
                      <li>
                        <span className="aod-legend-swatch" style={{ backgroundColor: '#ffff00' }} />
                        51-100 {'->'} Moderate
                      </li>
                      <li>
                        <span className="aod-legend-swatch" style={{ backgroundColor: '#ff7e00' }} />
                        101-150 {'->'} Unhealthy for Sensitive Groups
                      </li>
                      <li>
                        <span className="aod-legend-swatch" style={{ backgroundColor: '#ff0000' }} />
                        151-200 {'->'} Unhealthy
                      </li>
                      <li>
                        <span className="aod-legend-swatch" style={{ backgroundColor: '#8f3f97' }} />
                        201-300 {'->'} Very Unhealthy
                      </li>
                      <li>
                        <span className="aod-legend-swatch" style={{ backgroundColor: '#7e0023' }} />
                        301+ {'->'} Hazardous
                      </li>
                    </ul>
                  </div>
                </>
              )}
              {showAeronet && (
                <div className="aod-classification-legend">
                  <strong>AOD Classification:</strong>
                  <ul>
                    {AOD_CLASSIFICATION_LEGEND.map(({ range, label, color }) => (
                      <li key={range}>
                        <span className="aod-legend-swatch" style={{ backgroundColor: color }} />
                        {range} → {label}
                      </li>
                    ))}
                    <li>
                      <span className="aod-legend-swatch" style={{ backgroundColor: 'rgba(128, 128, 128, 0.8)' }} />
                      No AOD data
                    </li>
                  </ul>
                </div>
              )}
            </div>
          </aside>

          {/* Main map area */}
          <main className="dashboard-map-area">
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
            {showMERRA2PM25 && merra2Loading && merra2Stations.length === 0 && (
              <div className="map-loading-overlay map-loading-overlay--bottom-right" aria-live="polite">
                <div className="spinner-border spinner-border-sm text-primary" role="status" aria-hidden="true" />
                <p className="map-loading-text map-loading-text--small">Loading MERRA2 stations…</p>
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
                showAAQEForecast={showAAQEForecast}
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
          </main>

          {/* Right sidebar - Selected Data (show reopen only when something is selected) */}
          {!rightPanelOpen && showRightPanel && (
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
            <aside className="dashboard-sidebar-right">
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
                  <div className="selected-pm25-details">
                    <p className="data-source">MERRA2 CNN PM2.5 Station</p>
                    <table className="selected-data-table">
                      <tbody>
                        <tr><td>STATION</td><td>{activeSelectedMerra2Station.sitename}</td></tr>
                        <tr><td>COUNTRY</td><td>{activeSelectedMerra2Station.country ?? '—'}</td></tr>
                        <tr><td>ADDRESS</td><td>{activeSelectedMerra2Station.fullAddress ?? '—'}</td></tr>
                        <tr><td>PM2.5 (µg/m³)</td><td><strong>{activeSelectedMerra2Station.pm25.toFixed(2)}</strong></td></tr>
                        <tr>
                          <td>AQI</td>
                          <td>
                            <strong>{selectedMerra2Aqi ?? '—'}</strong>
                            {' '}({selectedMerra2AqiCategory.label})
                          </td>
                        </tr>
                        <tr><td>LAT / LON</td><td className="coord-cell">{activeSelectedMerra2Station.latitude.toFixed(5)}, {activeSelectedMerra2Station.longitude.toFixed(5)}</td></tr>
                        <tr><td>DATE</td><td>{formatDateMonthDayYear(activeSelectedMerra2Station.date)}</td></tr>
                      </tbody>
                    </table>
                    <p className="data-source-footer">
                      Source: MERRA2 parquet station archive
                    </p>
                  </div>
                ) : activeSelectedAAQE ? (
                  <div className="selected-pm25-details">
                    <p className="data-source">AAQE PM2.5 Forecast Station</p>
                    <table className="selected-data-table">
                      <tbody>
                        <tr><td>SITE</td><td>{activeSelectedAAQE.siteName ?? '—'}</td></tr>
                        <tr><td>STATION</td><td>{activeSelectedAAQE.station ?? '—'}</td></tr>
                        <tr><td>FORECAST DATE (UTC)</td><td>{activeSelectedAAQE.utcDate ?? '—'}</td></tr>
                        <tr><td>TIME SLOT</td><td>{activeSelectedAAQE.selectedTimeCode ?? '—'} UTC</td></tr>
                        <tr><td>3HR PM2.5 (µg/m³)</td><td>{activeSelectedAAQE.selectedPm?.toFixed(2) ?? '—'}</td></tr>
                        <tr><td>DAILY AQI</td><td>{activeSelectedAAQE.dailyAqi ?? '—'}</td></tr>
                        <tr><td>AQI CATEGORY</td><td>{getAqiCategory(activeSelectedAAQE.dailyAqi ?? null).label}</td></tr>
                        <tr><td>LAT / LON</td><td className="coord-cell">{activeSelectedAAQE.latitude.toFixed(5)}, {activeSelectedAAQE.longitude.toFixed(5)}</td></tr>
                      </tbody>
                    </table>
                    {activeSelectedAAQE.hourlyPm.length > 0 && (
                      <table className="selected-data-table">
                        <tbody>
                          <tr><td colSpan={2}><strong>3HR PM2.5 Forecast (CNN)</strong></td></tr>
                          {activeSelectedAAQE.hourlyPm.map((h) => (
                            <tr key={h.label}><td>{h.label}</td><td>{h.value.toFixed(2)}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {activeSelectedAAQE.hourlyAqi.length > 0 && (
                      <table className="selected-data-table">
                        <tbody>
                          <tr><td colSpan={2}><strong>3HR AQI Forecast</strong></td></tr>
                          {activeSelectedAAQE.hourlyAqi.map((h) => (
                            <tr key={h.label}><td>{h.label}</td><td>{Math.round(h.value)}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {aaqeThreeDayRows.length > 0 && (
                      <table className="selected-data-table">
                        <tbody>
                          <tr><td colSpan={2}><strong>3-Day DAILY AQI Forecast</strong></td></tr>
                          {aaqeThreeDayRows.map((r) => (
                            <tr key={`${r.label}-${r.date}`}>
                              <td>{r.label} ({r.date})</td>
                              <td>{Math.round(r.aqi)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    <p className="data-source-footer">
                      Source: AERONET AAQE GeoJSON forecast endpoint
                    </p>
                  </div>
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
