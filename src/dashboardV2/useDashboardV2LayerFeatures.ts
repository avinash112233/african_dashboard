import { useState, useEffect, useCallback, useMemo } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import {
  fetchAeronetSiteSeries,
  type AERONETDataPoint,
  type AERONETSite,
  type SiteAODMap,
  type AERONETAODVersion,
} from '../services/aeronetApi';
import type { FIRMSFirePoint } from '../services/firmsApi';
import { aggregateFiresByDate, getFireBrightness, normalizeFireDate } from '../utils/fireAnalytics';
import type { LatLonBounds } from '../utils/geoUtils';
import { distanceMeters, isPointInLatLonBounds } from '../utils/geoUtils';
import {
  getMERRA2StationTimeseries,
  type MERRA2StationDailyRecord,
  type MERRA2StationTimeseriesPoint,
} from '../services/merra2Api';
import {
  getOpenAqTimeseries,
  hasOpenAqPm25Value,
  seedOpenAqTimeseriesFromStation,
  type OpenAqMapMode,
  type OpenAqStationRecord,
  type OpenAqTimeseriesPoint,
} from '../services/openaqApi';
import { fetchWashUTimeseries, type WashUTimeseriesPoint } from '../services/washuApi';
import {
  getAaqeDisplayValues,
  getAaqeForecastDaysAfterSelected,
  type AAQEForecastPoint,
  type AaqeDisplayType,
} from '../services/aaqeForecastApi';
import { calculateAQIFromPm25, getAqiCategory } from '../utils/aqiUtils';
import {
  anchorFromAaqe,
  anchorFromFire,
  anchorFromMerra2,
} from '../analysis/locationAnchor';
import type { AnalysisLocationContext } from '../analysis/types';
import { computeDailyMeanAOD } from '../utils/aodUtils';
import { formatDateMonthDayYear } from '../utils/dateFormat';
import type { FireAnalysisRange, SelectedAAQEData, SelectedFireData } from './types';
import type { DashboardV2LayerKey } from './config';
import {
  getDefaultWashuSeriesRange,
  getWashuAnchorMonth,
  type WashuMonthRange,
} from './washuPlotRange';

export interface DashboardV2LayerFeaturesInput {
  showAeronet: boolean;
  showFires: boolean;
  showMERRA2PM25: boolean;
  showWashU: boolean;
  showOpenAq: boolean;
  showAAQEForecast: boolean;
  selectedDate: Dayjs;
  effectiveSelectedDateStr: string;
  merra2RequestedDate: string;
  merra2LatestDate: string | null;
  merra2Loading: boolean;
  merra2DataDate: string | null;
  merra2Stations: MERRA2StationDailyRecord[];
  firePoints: FIRMSFirePoint[];
  openAqMapMode: OpenAqMapMode;
  openAqMonitorsOnly: boolean;
  openAqLoading: boolean;
  openAqStations: OpenAqStationRecord[];
  aaqeForecastByDate: Record<string, AAQEForecastPoint[]>;
  aaqeForecastDate: string | null;
  aaqeDisplayType: AaqeDisplayType;
  aaqeTimeCode: string;
  siteAodMap: SiteAODMap;
  aeronetAodVersion: AERONETAODVersion;
  setAeronetAodVersion: (version: AERONETAODVersion) => void;
  onMetricUpdate: (selection: { label: string; value?: number; unit?: string }) => void;
  onSelectionMade?: () => void;
  plotStartDate: string;
  plotEndDate: string;
  plotRangeLabel: string;
  washuMapYear: number;
  washuMapMonth: number;
}

export function useDashboardV2LayerFeatures(input: DashboardV2LayerFeaturesInput) {
  const {
    showAeronet,
    showFires,
    showMERRA2PM25,
    showWashU,
    showOpenAq,
    showAAQEForecast,
    selectedDate,
    effectiveSelectedDateStr,
    merra2RequestedDate,
    merra2Loading,
    merra2DataDate,
    merra2Stations,
    firePoints,
    openAqMapMode,
    openAqMonitorsOnly: _openAqMonitorsOnly,
    openAqLoading: _openAqLoading,
    openAqStations,
    aaqeForecastByDate,
    aaqeDisplayType,
    aaqeTimeCode,
    siteAodMap,
    aeronetAodVersion,
    setAeronetAodVersion,
    onMetricUpdate,
    onSelectionMade,
    plotStartDate: analysisStartDate,
    plotEndDate: analysisEndDate,
    plotRangeLabel: analysisRangeLabel,
    washuMapYear,
    washuMapMonth,
  } = input;

  const washuAnchorMonth = useMemo(
    () => getWashuAnchorMonth(washuMapYear, washuMapMonth),
    [washuMapYear, washuMapMonth]
  );

  const applyWashuMonthRange = useCallback((range: WashuMonthRange) => {
    setWashuSeriesStartYear(range.startYear);
    setWashuSeriesStartMonth(range.startMonth);
    setWashuSeriesEndYear(range.endYear);
    setWashuSeriesEndMonth(range.endMonth);
    setWashuAppliedSeriesRange(range);
  }, []);

  const [selectedSite, setSelectedSite] = useState<AERONETSite | null>(null);
  const [selectedFire, setSelectedFire] = useState<SelectedFireData | null>(null);
  const [selectedMerra2Station, setSelectedMerra2Station] = useState<MERRA2StationDailyRecord | null>(
    null
  );
  const [selectedOpenAqStation, setSelectedOpenAqStation] = useState<OpenAqStationRecord | null>(null);
  const [selectedAAQE, setSelectedAAQE] = useState<SelectedAAQEData | null>(null);
  const [analysisAnchor, setAnalysisAnchor] = useState<AnalysisLocationContext | null>(null);
  const [chartData, setChartData] = useState<AERONETDataPoint[]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);
  const [chartFromCache, setChartFromCache] = useState(false);

  const [aeronetDateFrom, setAeronetDateFrom] = useState(() => dayjs().subtract(7, 'day'));
  const [aeronetDateTo, setAeronetDateTo] = useState(() => dayjs());
  const [fireAnalysisRange, setFireAnalysisRange] = useState<FireAnalysisRange>('7D');

  const [merra2Series, setMerra2Series] = useState<MERRA2StationTimeseriesPoint[]>([]);
  const [merra2SeriesLoading, setMerra2SeriesLoading] = useState(false);
  const [merra2DateFrom, setMerra2DateFrom] = useState(() => dayjs().subtract(6, 'day'));
  const [merra2DateTo, setMerra2DateTo] = useState(() => dayjs());
  const [merra2AppliedRange, setMerra2AppliedRange] = useState(() => ({
    start: dayjs().subtract(6, 'day').format('YYYY-MM-DD'),
    end: dayjs().format('YYYY-MM-DD'),
  }));

  const [openAqSeries, setOpenAqSeries] = useState<OpenAqTimeseriesPoint[]>([]);
  const [openAqSeriesLoading, setOpenAqSeriesLoading] = useState(false);
  const [openAqDateFrom, setOpenAqDateFrom] = useState(() => dayjs().subtract(6, 'day'));
  const [openAqDateTo, setOpenAqDateTo] = useState(() => dayjs());
  const [openAqAppliedRange, setOpenAqAppliedRange] = useState(() => ({
    start: dayjs().subtract(6, 'day').format('YYYY-MM-DD'),
    end: dayjs().format('YYYY-MM-DD'),
  }));

  const [washuPin, setWashuPin] = useState<{ lat: number; lon: number; pm25: number | null } | null>(
    null
  );
  const [washuSeries, setWashuSeries] = useState<WashUTimeseriesPoint[]>([]);
  const [washuSeriesLoading, setWashuSeriesLoading] = useState(false);
  const [washuSeriesError, setWashuSeriesError] = useState<string | null>(null);
  const [washuSeriesStartYear, setWashuSeriesStartYear] = useState(() => {
    const range = getDefaultWashuSeriesRange(getWashuAnchorMonth(2023, 12));
    return range.startYear;
  });
  const [washuSeriesStartMonth, setWashuSeriesStartMonth] = useState(() => {
    const range = getDefaultWashuSeriesRange(getWashuAnchorMonth(2023, 12));
    return range.startMonth;
  });
  const [washuSeriesEndYear, setWashuSeriesEndYear] = useState(() => {
    const range = getDefaultWashuSeriesRange(getWashuAnchorMonth(2023, 12));
    return range.endYear;
  });
  const [washuSeriesEndMonth, setWashuSeriesEndMonth] = useState(() => {
    const range = getDefaultWashuSeriesRange(getWashuAnchorMonth(2023, 12));
    return range.endMonth;
  });
  const [washuAppliedSeriesRange, setWashuAppliedSeriesRange] = useState(() =>
    getDefaultWashuSeriesRange(getWashuAnchorMonth(2023, 12))
  );

  const [circleSelectActive, setCircleSelectActive] = useState(false);
  const [circleCenter, setCircleCenter] = useState<[number, number] | null>(null);
  const [circleRadiusKm] = useState(5);
  const [fireChartRectDrawActive, setFireChartRectDrawActive] = useState(false);
  const [fireChartBounds, setFireChartBounds] = useState<LatLonBounds | null>(null);

  const merra2AnalysisStartDate = merra2AppliedRange.start;
  const merra2AnalysisEndDate = merra2AppliedRange.end;

  useEffect(() => {
    setMerra2DateFrom(dayjs(analysisStartDate, 'YYYY-MM-DD'));
    setMerra2DateTo(dayjs(analysisEndDate, 'YYYY-MM-DD'));
    setMerra2AppliedRange({ start: analysisStartDate, end: analysisEndDate });
  }, [analysisStartDate, analysisEndDate]);

  useEffect(() => {
    setOpenAqDateFrom(dayjs(analysisStartDate, 'YYYY-MM-DD'));
    setOpenAqDateTo(dayjs(analysisEndDate, 'YYYY-MM-DD'));
    setOpenAqAppliedRange({ start: analysisStartDate, end: analysisEndDate });
  }, [analysisStartDate, analysisEndDate]);

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

  const fireRangeEnd = useMemo(
    () =>
      latestFireDateTime
        ? latestFireDateTime.endOf('minute')
        : dayjs(effectiveSelectedDateStr).endOf('day'),
    [latestFireDateTime, effectiveSelectedDateStr]
  );
  const fireRangeStart = useMemo(
    () => fireRangeEnd.subtract(fireRangeHours, 'hour'),
    [fireRangeEnd, fireRangeHours]
  );
  const fireRangeLabel =
    fireAnalysisRange === '24H'
      ? 'Last 24 Hours'
      : fireAnalysisRange === '48H'
        ? 'Last 48 Hours'
        : 'Last 7 Days';

  const firesAfterSpatialFilter = useMemo(() => {
    if (!fireChartBounds) return preparedFirePoints;
    return preparedFirePoints.filter((p) =>
      isPointInLatLonBounds(p.fire.latitude, p.fire.longitude, fireChartBounds)
    );
  }, [preparedFirePoints, fireChartBounds]);

  const firesInAnalysisRange = useMemo(() => {
    return firesAfterSpatialFilter.filter((f) => {
      const d = f.dateTime;
      return (
        (d.isAfter(fireRangeStart) || d.isSame(fireRangeStart)) &&
        (d.isBefore(fireRangeEnd) || d.isSame(fireRangeEnd))
      );
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

  useEffect(() => {
    if (showFires) return;
    setFireChartRectDrawActive(false);
    setFireChartBounds(null);
    setCircleCenter(null);
    setCircleSelectActive(false);
  }, [showFires]);

  useEffect(() => {
    if (!showMERRA2PM25) return;
    setSelectedMerra2Station((prev) =>
      prev ? merra2Stations.find((s) => s.sitename === prev.sitename) ?? null : null
    );
  }, [merra2Stations, showMERRA2PM25]);

  useEffect(() => {
    setAeronetDateTo(selectedDate);
    setAeronetDateFrom(selectedDate.subtract(7, 'day'));
  }, [selectedDate]);

  useEffect(() => {
    if (!showOpenAq) return;
    setSelectedOpenAqStation((prev) =>
      prev ? openAqStations.find((s) => s.sensorId === prev.sensorId) ?? null : null
    );
  }, [openAqStations, showOpenAq]);

  useEffect(() => {
    if (!selectedSite) {
      setChartData([]);
      setChartError(null);
      setChartFromCache(false);
      return;
    }
    let cancelled = false;
    setChartLoading(true);
    setChartError(null);
    setChartFromCache(false);
    fetchAeronetSiteSeries(selectedSite, analysisStartDate, analysisEndDate, aeronetAodVersion)
      .then((result) => {
        if (cancelled) return;
        setChartData(Array.isArray(result.points) ? result.points : []);
        setChartError(result.error ?? null);
        setChartFromCache(Boolean(result.fromCache));
      })
      .catch((err) => {
        if (cancelled) return;
        setChartData([]);
        setChartError(err instanceof Error ? err.message : 'Failed to load AERONET data');
        setChartFromCache(false);
      })
      .finally(() => {
        if (!cancelled) setChartLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [analysisStartDate, analysisEndDate, selectedSite, aeronetAodVersion]);

  const openAqAnalysisStartDate = openAqAppliedRange.start;
  const openAqAnalysisEndDate = openAqAppliedRange.end;

  useEffect(() => {
    if (!showOpenAq || !selectedOpenAqStation || openAqMapMode !== 'daily') {
      setOpenAqSeries([]);
      setOpenAqSeriesLoading(false);
      return;
    }
    const controller = new AbortController();
    setOpenAqSeriesLoading(true);
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
      .catch(() => {
        if (controller.signal.aborted) return;
        setOpenAqSeries([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setOpenAqSeriesLoading(false);
      });
    return () => controller.abort();
  }, [showOpenAq, openAqMapMode, selectedOpenAqStation?.sensorId, selectedOpenAqStation?.locationId, openAqAnalysisStartDate, openAqAnalysisEndDate]);

  useEffect(() => {
    if (!showMERRA2PM25 || !selectedMerra2Station) return;
    setMerra2SeriesLoading(true);
    getMERRA2StationTimeseries(
      selectedMerra2Station.sitename,
      merra2AnalysisStartDate,
      merra2AnalysisEndDate
    )
      .then((res) => {
        setMerra2Series(Array.isArray(res.points) ? res.points : []);
      })
      .catch(() => {
        setMerra2Series([]);
      })
      .finally(() => setMerra2SeriesLoading(false));
  }, [
    showMERRA2PM25,
    selectedMerra2Station?.sitename,
    merra2AnalysisStartDate,
    merra2AnalysisEndDate,
  ]);

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
        if ((res.points?.length ?? 0) === 0) {
          setWashuSeriesError('No PM2.5 values for this location in the selected range.');
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

  const derivedSiteAodMap = useMemo(
    () =>
      Object.keys(siteAodMap).length > 0
        ? siteAodMap
        : selectedSite && chartData.length > 0
          ? {
              [selectedSite.site]: { hasData: true },
              [selectedSite.name ?? '']: { hasData: true },
            }
          : siteAodMap,
    [siteAodMap, selectedSite, chartData]
  );

  const dailyMeanAod = useMemo(() => computeDailyMeanAOD(chartData), [chartData]);

  const handleCircleCenterChange = useCallback((lat: number, lng: number) => {
    setCircleCenter([lat, lng]);
  }, []);

  const handleCircleClose = useCallback(() => {
    setCircleCenter(null);
    setCircleSelectActive(false);
    setFireChartBounds(null);
    setFireChartRectDrawActive(false);
  }, []);

  const handleMerra2StationClick = useCallback(
    (station: MERRA2StationDailyRecord) => {
      setSelectedMerra2Station(station);
      setSelectedSite(null);
      setSelectedFire(null);
      setSelectedAAQE(null);
      setSelectedOpenAqStation(null);
      setWashuPin(null);
      setAnalysisAnchor(anchorFromMerra2(station));
      setChartData([]);
      onMetricUpdate({
        label: station.sitename,
        value: station.pm25,
        unit: 'µg/m³',
      });
      onSelectionMade?.();
    },
    [onMetricUpdate, onSelectionMade]
  );

  const handleOpenAqStationClick = useCallback(
    (station: OpenAqStationRecord) => {
      setSelectedOpenAqStation(station);
      setSelectedSite(null);
      setSelectedFire(null);
      setSelectedAAQE(null);
      setSelectedMerra2Station(null);
      setWashuPin(null);
      setChartData([]);
      onMetricUpdate({
        label: station.name,
        value: station.pm25 ?? undefined,
        unit: 'µg/m³',
      });
      onSelectionMade?.();
    },
    [onMetricUpdate, onSelectionMade]
  );

  const handleAeronetSiteClick = useCallback(
    (site: AERONETSite) => {
      setSelectedSite(site);
      setSelectedFire(null);
      setSelectedMerra2Station(null);
      setSelectedOpenAqStation(null);
      setSelectedAAQE(null);
      setWashuPin(null);
      setChartData([]);
      const entry = siteAodMap[site.site];
      const aod =
        entry && 'hasData' in entry && entry.hasData ? entry.AOD_500nm : undefined;
      onMetricUpdate({
        label: site.name ?? site.site,
        value: aod,
        unit: 'AOD',
      });
      onSelectionMade?.();
    },
    [onMetricUpdate, onSelectionMade, siteAodMap]
  );

  const clearAnalysisAnchor = useCallback(() => {
    setAnalysisAnchor(null);
  }, []);

  const clearAllSelections = useCallback(() => {
    setSelectedSite(null);
    setSelectedFire(null);
    setSelectedMerra2Station(null);
    setSelectedOpenAqStation(null);
    setSelectedAAQE(null);
    setWashuPin(null);
    setAnalysisAnchor(null);
    setChartData([]);
    setCircleCenter(null);
    setCircleSelectActive(false);
    setFireChartBounds(null);
    setFireChartRectDrawActive(false);
  }, []);

  const dismissAeronetSelection = useCallback(() => {
    setSelectedSite(null);
    setChartData([]);
    setAnalysisAnchor(null);
    onMetricUpdate({ label: 'Africa overview', unit: undefined, value: undefined });
  }, [onMetricUpdate]);

  const dismissLayerSelection = useCallback(
    (layer: DashboardV2LayerKey) => {
      if (layer === 'aeronet') {
        dismissAeronetSelection();
        return;
      }
      if (layer === 'fires') {
        setSelectedFire(null);
        setCircleSelectActive(false);
        setCircleCenter(null);
        setFireChartRectDrawActive(false);
        setFireChartBounds(null);
        return;
      }
      if (layer === 'merra2') {
        setSelectedMerra2Station(null);
        return;
      }
      if (layer === 'openaq') {
        setSelectedOpenAqStation(null);
        return;
      }
      if (layer === 'washu') {
        setWashuPin(null);
        setWashuSeries([]);
        return;
      }
      if (layer === 'aaqe') {
        setSelectedAAQE(null);
      }
    },
    [dismissAeronetSelection]
  );

  const exportAODCSV = useCallback(() => {
    if (!selectedSite || chartData.length === 0) return;
    const headers = ['date', 'time', 'dayOfYear', 'AOD_500nm', 'AOD_675nm', 'AOD_870nm', 'AOD_1020nm'];
    const rows = chartData.map((d) =>
      [
        d.date,
        d.time ?? '',
        d.dayOfYear ?? '',
        d.AOD_500nm ?? '',
        d.AOD_675nm ?? '',
        d.AOD_870nm ?? '',
        d.AOD_1020nm ?? '',
      ].join(',')
    );
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AERONET_${selectedSite.site}_${analysisStartDate}_to_${analysisEndDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [selectedSite, chartData, analysisStartDate, analysisEndDate]);

  const handleFireClick = useCallback(
    (fire: FIRMSFirePoint) => {
      setSelectedSite(null);
      setSelectedMerra2Station(null);
      setSelectedOpenAqStation(null);
      setSelectedAAQE(null);
      setWashuPin(null);
      setChartData([]);
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
      onMetricUpdate({
        label: `Fire hotspot (${fire.latitude.toFixed(2)}, ${fire.longitude.toFixed(2)})`,
        value: fire.frp ?? undefined,
        unit: 'MW',
      });
      onSelectionMade?.();
    },
    [onMetricUpdate, onSelectionMade]
  );

  const handleAAQEForecastClick = useCallback(
    (point: AAQEForecastPoint) => {
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
      setWashuPin(null);
      setChartData([]);
      onMetricUpdate({
        label: siteName ?? station ?? 'Forecast site',
        value: displayPm ?? undefined,
        unit: 'µg/m³',
      });
      onSelectionMade?.();
    },
    [aaqeTimeCode, aaqeDisplayType, onMetricUpdate, onSelectionMade]
  );

  const handleFireChartBoundsCommit = useCallback((bounds: LatLonBounds) => {
    setFireChartBounds(bounds);
    setFireChartRectDrawActive(false);
  }, []);

  const clearFireChartRectangle = useCallback(() => {
    setFireChartBounds(null);
    setFireChartRectDrawActive(false);
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
    setMerra2DateFrom(dayjs(analysisStartDate, 'YYYY-MM-DD'));
    setMerra2DateTo(dayjs(analysisEndDate, 'YYYY-MM-DD'));
    setMerra2AppliedRange({
      start: analysisStartDate,
      end: analysisEndDate,
    });
  }, [analysisStartDate, analysisEndDate]);

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
    setOpenAqDateFrom(dayjs(analysisStartDate, 'YYYY-MM-DD'));
    setOpenAqDateTo(dayjs(analysisEndDate, 'YYYY-MM-DD'));
    setOpenAqAppliedRange({
      start: analysisStartDate,
      end: analysisEndDate,
    });
  }, [analysisStartDate, analysisEndDate]);

  const handleWashuMapClick = useCallback(
    (lat: number, lon: number) => {
      applyWashuMonthRange(getDefaultWashuSeriesRange(washuAnchorMonth));
      setWashuPin({ lat, lon, pm25: null });
      setSelectedSite(null);
      setSelectedFire(null);
      setSelectedMerra2Station(null);
      setSelectedOpenAqStation(null);
      setSelectedAAQE(null);
      setChartData([]);
      setAnalysisAnchor(null);
      onMetricUpdate({
        label: `WashU location (${lat.toFixed(2)}, ${lon.toFixed(2)})`,
      });
      onSelectionMade?.();
    },
    [applyWashuMonthRange, washuAnchorMonth, onMetricUpdate, onSelectionMade]
  );

  const updateWashuPm25Sample = useCallback((value: number | null) => {
    if (value == null) return;
    setWashuPin((prev) => (prev ? { ...prev, pm25: value } : prev));
  }, []);

  const washuDraftSeriesRange = useMemo(
    () => ({
      startYear: washuSeriesStartYear,
      startMonth: washuSeriesStartMonth,
      endYear: washuSeriesEndYear,
      endMonth: washuSeriesEndMonth,
    }),
    [washuSeriesStartYear, washuSeriesStartMonth, washuSeriesEndYear, washuSeriesEndMonth]
  );

  const washuSeriesRangePending = useMemo(
    () =>
      washuDraftSeriesRange.startYear !== washuAppliedSeriesRange.startYear ||
      washuDraftSeriesRange.startMonth !== washuAppliedSeriesRange.startMonth ||
      washuDraftSeriesRange.endYear !== washuAppliedSeriesRange.endYear ||
      washuDraftSeriesRange.endMonth !== washuAppliedSeriesRange.endMonth,
    [washuDraftSeriesRange, washuAppliedSeriesRange]
  );

  const setWashuSeriesStartMonthInput = useCallback((value: string) => {
    const parsed = /^(\d{4})-(\d{2})$/.exec(value);
    if (!parsed) return;
    const year = Number(parsed[1]);
    const month = Number(parsed[2]);
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return;
    setWashuSeriesStartYear(year);
    setWashuSeriesStartMonth(month);
  }, []);

  const setWashuSeriesEndMonthInput = useCallback((value: string) => {
    const parsed = /^(\d{4})-(\d{2})$/.exec(value);
    if (!parsed) return;
    const year = Number(parsed[1]);
    const month = Number(parsed[2]);
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return;
    setWashuSeriesEndYear(year);
    setWashuSeriesEndMonth(month);
  }, []);

  const applyWashuSeriesPreset = useCallback(
    (range: WashuMonthRange) => {
      applyWashuMonthRange(range);
    },
    [applyWashuMonthRange]
  );

  const applyWashuSeriesRange = useCallback(() => {
    setWashuAppliedSeriesRange(washuDraftSeriesRange);
  }, [washuDraftSeriesRange]);

  const resetWashuSeriesRange = useCallback(() => {
    applyWashuMonthRange(getDefaultWashuSeriesRange(washuAnchorMonth));
  }, [applyWashuMonthRange, washuAnchorMonth]);

  const applyPlotRange = useCallback(() => {
    setMerra2AppliedRange({ start: analysisStartDate, end: analysisEndDate });
    setOpenAqAppliedRange({ start: analysisStartDate, end: analysisEndDate });
  }, [analysisStartDate, analysisEndDate]);

  const resetPlotRange = useCallback(() => {
    setMerra2AppliedRange({ start: analysisStartDate, end: analysisEndDate });
    setOpenAqAppliedRange({ start: analysisStartDate, end: analysisEndDate });
  }, [analysisStartDate, analysisEndDate]);

  useEffect(() => {
    if (showWashU) return;
    setWashuPin(null);
    setWashuSeries([]);
    setWashuSeriesError(null);
  }, [showWashU]);

  const merra2PanelDataDate = merra2DataDate ?? merra2RequestedDate;
  const merra2PanelStation = useMemo(() => {
    if (!showMERRA2PM25 || !selectedMerra2Station) return null;
    if (!merra2DataDate) return selectedMerra2Station;
    return (
      merra2Stations.find((s) => s.sitename === selectedMerra2Station.sitename) ??
      selectedMerra2Station
    );
  }, [showMERRA2PM25, selectedMerra2Station, merra2DataDate, merra2Stations]);
  const merra2PanelMetricsLoading =
    showMERRA2PM25 && Boolean(selectedMerra2Station) && merra2Loading;

  const activeSelectedSite = showAeronet ? selectedSite : null;
  const activeSelectedFire = showFires ? selectedFire : null;
  const activeSelectedMerra2Station = merra2PanelStation;
  const activeSelectedOpenAq = showOpenAq ? selectedOpenAqStation : null;
  const activeSelectedAAQE = showAAQEForecast ? selectedAAQE : null;
  const activeSelectedWashU = showWashU && washuPin ? washuPin : null;

  const aaqeForecastDateOptions = useMemo(() => {
    if (!showAAQEForecast) return [];
    const base = selectedDate.isAfter(dayjs(), 'day') ? dayjs() : selectedDate;
    return getAaqeForecastDaysAfterSelected(base.format('YYYY-MM-DD'));
  }, [showAAQEForecast, selectedDate]);

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
  const selectedOpenAqAqi =
    activeSelectedOpenAq && hasOpenAqPm25Value(activeSelectedOpenAq)
      ? calculateAQIFromPm25(activeSelectedOpenAq.pm25!)
      : null;
  const openAqChartDisplayPoints = useMemo(() => {
    if (openAqSeries.length > 0) return openAqSeries;
    if (!selectedOpenAqStation) return [];
    return seedOpenAqTimeseriesFromStation(
      selectedOpenAqStation,
      openAqMapMode === 'daily' ? effectiveSelectedDateStr : undefined
    );
  }, [openAqSeries, selectedOpenAqStation, openAqMapMode, effectiveSelectedDateStr]);

  const showAnalysisSection = analysisAnchor != null;

  return {
    selectedSite,
    selectedFire,
    selectedMerra2Station,
    selectedOpenAqStation,
    selectedAAQE,
    analysisAnchor,
    chartData,
    chartLoading,
    chartError,
    chartFromCache,

    fireAnalysisRange,
    setFireAnalysisRange,
    fireChartRectDrawActive,
    setFireChartRectDrawActive,
    fireChartBounds,
    circleCenter,
    circleSelectActive,
    circleRadiusKm,
    fireDailyStats,
    fireScatterPoints,
    fireRangeStart,
    fireRangeEnd,
    fireRangeLabel,
    pointsInSelection,
    clearFireChartRectangle,
    handleFireClick,
    activeSelectedFire,
    handleFireChartBoundsCommit,

    aeronetAodVersion,
    setAeronetAodVersion,
    aeronetDateFrom,
    setAeronetDateFrom,
    aeronetDateTo,
    setAeronetDateTo,
    analysisStartDate,
    analysisEndDate,
    analysisRangeLabel,
    dailyMeanAod,
    derivedSiteAodMap,
    exportAODCSV,
    handleAeronetSiteClick,
    dismissAeronetSelection,
    dismissLayerSelection,

    merra2Series,
    merra2SeriesLoading,
    merra2DateFrom,
    setMerra2DateFrom,
    merra2DateTo,
    setMerra2DateTo,
    merra2AppliedRange,
    applyMerra2Range,
    resetMerra2Range,
    handleMerra2StationClick,
    activeSelectedMerra2Station,
    selectedMerra2Aqi,
    merra2PanelDataDate,
    merra2PanelMetricsLoading,

    openAqSeries,
    openAqChartDisplayPoints,
    openAqSeriesLoading,
    openAqDateFrom,
    setOpenAqDateFrom,
    openAqDateTo,
    setOpenAqDateTo,
    openAqAppliedRange,
    applyOpenAqRange,
    resetOpenAqRange,
    handleOpenAqStationClick,
    activeSelectedOpenAq,
    selectedOpenAqAqi,

    washuPin,
    washuSeries,
    washuSeriesLoading,
    washuSeriesError,
    washuSeriesStartYear,
    setWashuSeriesStartYear,
    washuSeriesStartMonth,
    setWashuSeriesStartMonth,
    washuSeriesEndYear,
    setWashuSeriesEndYear,
    washuSeriesEndMonth,
    setWashuSeriesEndMonth,
    washuAppliedSeriesRange,
    washuDraftSeriesRange,
    washuSeriesRangePending,
    setWashuSeriesStartMonthInput,
    setWashuSeriesEndMonthInput,
    applyWashuSeriesPreset,
    applyWashuSeriesRange,
    resetWashuSeriesRange,
    applyPlotRange,
    resetPlotRange,
    handleWashuMapClick,
    updateWashuPm25Sample,
    activeSelectedWashU,

    handleAAQEForecastClick,
    activeSelectedAAQE,
    aaqeThreeDaySeries,
    aaqeThreeDayRows,
    setSelectedAAQE,

    clearAnalysisAnchor,
    activeSelectedSite,
    showAnalysisSection,

    handleCircleCenterChange,
    handleCircleClose,
    clearAllSelections,
  };
}
