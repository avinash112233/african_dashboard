import { useState, useEffect, useCallback, useMemo } from 'react';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import dayjs from 'dayjs';
import L from 'leaflet';
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
import {
  TimeSeriesChart,
  ScatterPlotChart,
  WavelengthBarChart,
  FireCountTimeSeriesChart,
  FireAverageFrpTimeSeriesChart,
  FireBrightnessFrpScatterChart,
  MERRA2StationTimeSeriesChart,
} from '../components/charts';
import { normalizeAeronetDate, formatDateMonthDayYear, formatDisplayDate } from '../utils/dateFormat';
import { computeDailyMeanAOD, getAODLevelColor, getAODLevelLabel, AOD_CLASSIFICATION_LEGEND } from '../utils/aodUtils';
import { aggregateFiresByDate, getFireBrightness, normalizeFireDate } from '../utils/fireAnalytics';
import type { LatLonBounds } from '../utils/geoUtils';
import { isPointInLatLonBounds } from '../utils/geoUtils';
import {
  getMERRA2LatestDate,
  getMERRA2StationsByDate,
  getMERRA2StationTimeseries,
  type MERRA2StationDailyRecord,
  type MERRA2StationTimeseriesPoint,
} from '../services/merra2Api';
import { calculateAQIFromPm25, getAqiCategory } from '../utils/aqiUtils';
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

const DashboardPage = () => {
  const [selectedDate, setSelectedDate] = useState(dayjs());
  const [selectedFire, setSelectedFire] = useState<SelectedFireData | null>(null);
  const [firePoints, setFirePoints] = useState<FIRMSFirePoint[]>([]);
  const [aeronetSites, setAeronetSites] = useState<AERONETSite[]>([]);
  type LayerMode = 'aeronet' | 'fires' | 'viirs' | 'merra2';
  const [activeLayer, setActiveLayer] = useState<LayerMode>('aeronet');
  const showAeronet = activeLayer === 'aeronet';
  const showFires = activeLayer === 'fires';
  const showVIIRSImagery = activeLayer === 'viirs';
  const showMERRA2PM25 = activeLayer === 'merra2';
  const [selectedMerra2Station, setSelectedMerra2Station] = useState<MERRA2StationDailyRecord | null>(null);
  const [merra2Stations, setMerra2Stations] = useState<MERRA2StationDailyRecord[]>([]);
  const [merra2Series, setMerra2Series] = useState<MERRA2StationTimeseriesPoint[]>([]);
  const [merra2SeriesLoading, setMerra2SeriesLoading] = useState(false);
  const [merra2Error, setMerra2Error] = useState<string | null>(null);
  const [merra2Notice, setMerra2Notice] = useState<string | null>(null);
  const [merra2DataDate, setMerra2DataDate] = useState<string | null>(null);
  const [merra2LatestDate, setMerra2LatestDate] = useState<string | null>(null);
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
    const end = dayjs(selectedDateStr, 'YYYY-MM-DD').startOf('day');
    const days = range === '7D' ? 7 : range === '30D' ? 30 : 90;
    // Inclusive range (last N days ending on selectedDate)
    const start = end.subtract(days - 1, 'day');
    return { startDate: start.format('YYYY-MM-DD'), endDate: end.format('YYYY-MM-DD') };
  };

  const effectiveSelectedDate = selectedDate.isAfter(dayjs(), 'day') ? dayjs() : selectedDate;
  const effectiveSelectedDateStr = effectiveSelectedDate.format('YYYY-MM-DD');
  const merra2DefaultLatestDate = '2025-12-31';
  const merra2RequestedDate = useMemo(() => {
    const base = selectedDate.isAfter(dayjs(), 'day') ? dayjs() : selectedDate;
    const maxSupported = dayjs(merra2DefaultLatestDate);
    return base.isAfter(maxSupported, 'day') ? merra2DefaultLatestDate : base.format('YYYY-MM-DD');
  }, [selectedDate]);
  const { startDate: analysisStartDate, endDate: analysisEndDate } = getDateRange(effectiveSelectedDateStr, analysisRange);
  const merra2AnchorDateStr = merra2DataDate ?? effectiveSelectedDateStr;
  const { startDate: merra2AnalysisStartDate, endDate: merra2AnalysisEndDate } = getDateRange(merra2AnchorDateStr, analysisRange);
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
    const prepared: PreparedFirePoint[] = [];
    for (const fire of firePoints) {
      const dt = getFireDateTime(fire.acq_date, fire.acq_time);
      if (!dt || !dt.isValid()) continue;
      prepared.push({ fire, dateTime: dt });
    }
    return prepared;
  }, [firePoints, getFireDateTime]);

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
    const points: { x: number; y: number; confidence?: string }[] = [];
    for (const item of firesInAnalysisRange) {
      const f = item.fire;
      const brightness = getFireBrightness(f);
      const frp = f.frp;
      if (brightness == null || frp == null || !Number.isFinite(frp)) continue;
      points.push({ x: brightness, y: frp, confidence: f.confidence });
    }
    return points;
  }, [firesInAnalysisRange]);

  // Keep a consistent rolling AERONET window based on the selected date.
  // When the user picks a date, we automatically set:
  // - "To" = selected date
  // - "From" = 7 days prior
  useEffect(() => {
    setAeronetDateTo(selectedDate);
    setAeronetDateFrom(selectedDate.subtract(7, 'day'));
  }, [selectedDate]);

  useEffect(() => {
    setFireLoading(true);
    getNOAA21VIIRS7DayFromWFS()
      .then(setFirePoints)
      .finally(() => setFireLoading(false));
  }, [selectedDate]);

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

  // Debounce AERONET Africa AOD fetch (300ms) to avoid rapid API calls on date picker changes
  useEffect(() => {
    if (!showAeronet) return;
    const start = aeronetStart.format('YYYY-MM-DD');
    const end = aeronetEnd.format('YYYY-MM-DD');
    const t = window.setTimeout(() => {
      getAERONETDataAfrica(start, end, aeronetAodVersion).then(setSiteAodMap);
    }, 300);
    return () => window.clearTimeout(t);
  }, [aeronetDateFrom, aeronetDateTo, showAeronet, aeronetAodVersion]);

  const handleMerra2StationClick = useCallback((station: MERRA2StationDailyRecord) => {
    setSelectedMerra2Station(station);
    setSelectedSite(null);
    setSelectedFire(null);
    setChartData([]);
    setRightPanelOpen(true);
  }, []);

  useEffect(() => {
    setAeronetLoading(true);
    setAeronetError(null);
    getAfricanAERONETSites()
      .then((data) => {
        setAeronetSites(data);
      })
      .catch((err) => {
        setAeronetError(err?.message || 'Failed to fetch AERONET sites: AERONET API error (500 Internal Server Error): No error details');
      })
      .finally(() => setAeronetLoading(false));
  }, []);

  useEffect(() => {
    if (!showMERRA2PM25) return;
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
        setSelectedMerra2Station((prev) =>
          prev ? stations.find((s) => s.sitename === prev.sitename) ?? null : null
        );
        return;
      } catch (err) {
        const message = String(err?.message || '');
        const noDataForDate = /No station data found for date/i.test(message);
        if (!noDataForDate) {
          if (cancelled) return;
          setMerra2DataDate(null);
          setMerra2Stations([]);
          setSelectedMerra2Station(null);
          setMerra2Series([]);
          setMerra2Error(err?.message || 'Failed to load MERRA2 stations.');
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
        setSelectedMerra2Station((prev) =>
          prev ? latestStations.find((s) => s.sitename === prev.sitename) ?? null : null
        );
        if (latestDate !== requestedDate) {
          setMerra2Notice(`No MERRA2 station data for ${requestedDate}. Showing latest available date: ${latestDate}.`);
        }
      } catch (err) {
        if (cancelled) return;
        setMerra2DataDate(null);
        setMerra2Stations([]);
        setSelectedMerra2Station(null);
        setMerra2Series([]);
        setMerra2Error(err?.message || 'Failed to load MERRA2 stations.');
      } finally {
        if (!cancelled) setMerra2Loading(false);
      }
    };

    loadStations();
    return () => {
      cancelled = true;
    };
  }, [showMERRA2PM25, merra2RequestedDate, merra2LatestDate]);

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
    const centerLatLng = L.latLng(circleCenter[0], circleCenter[1]);
    const radiusM = circleRadiusKm * 1000;
    const inCircle = firePoints.filter((p) => {
      if (isNaN(p.latitude) || isNaN(p.longitude)) return false;
      return centerLatLng.distanceTo(L.latLng(p.latitude, p.longitude)) <= radiusM;
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
    setChartData([]);
    setRightPanelOpen(true);
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
    setChartData([]);
    setRightPanelOpen(true);
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
      if (prev === 'merra2') {
        setMerra2Loading(false);
        setMerra2Stations([]);
        setSelectedMerra2Station(null);
        setMerra2Series([]);
        setMerra2SeriesLoading(false);
        setMerra2Error(null);
        setMerra2Notice(null);
        setMerra2DataDate(null);
        setMerra2LatestDate(null);
      }
      return next;
    });
  }, []);

  const activeSelectedSite = showAeronet ? selectedSite : null;
  const activeSelectedFire = showFires ? selectedFire : null;
  const activeSelectedMerra2Station = showMERRA2PM25 ? selectedMerra2Station : null;
  const selectedMerra2Aqi = activeSelectedMerra2Station
    ? calculateAQIFromPm25(activeSelectedMerra2Station.pm25)
    : null;
  const selectedMerra2AqiCategory = getAqiCategory(selectedMerra2Aqi);
  const hasActiveLayerSelection = Boolean(
    activeSelectedSite || activeSelectedFire || activeSelectedMerra2Station
  );

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
                  disabled={aeronetLoading}
                />
                AERONET Sites {aeronetLoading && '(loading...)'}
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
                  disabled={fireLoading}
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
            {fireLoading && (
              <div className="map-loading-overlay map-loading-overlay--bottom-right">
                <div className="spinner-border spinner-border-sm text-primary" role="status" aria-hidden="true" />
                <p className="map-loading-text map-loading-text--small">Loading fire…</p>
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
              />
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
                      aria-label="MERRA2 Analysis Range"
                    >
                      <option value="7D">Last 7 Days</option>
                      <option value="30D">Last 30 Days</option>
                      <option value="90D">Last 90 Days</option>
                    </select>
                  </div>
                </div>
                <small className="layer-tip" style={{ marginTop: 2, display: 'block', textAlign: 'left' }}>
                  Station: {selectedMerra2Station.sitename} · Showing: {analysisRangeLabel} ({formatDisplayDate(merra2AnalysisStartDate)} – {formatDisplayDate(merra2AnalysisEndDate)})
                </small>
                {merra2SeriesLoading ? (
                  <div className="chart-loading-box">
                    <div className="chart-loading-spinner" />
                    <p className="chart-loading">Loading PM2.5 series for {selectedMerra2Station.sitename}…</p>
                  </div>
                ) : (
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
                )}
              </div>
            )}
          </main>

          {/* Right sidebar - Selected Data (show reopen only when something is selected) */}
          {!rightPanelOpen && hasActiveLayerSelection && (
            <button
              type="button"
              className="panel-reopen-btn"
              onClick={() => setRightPanelOpen(true)}
              title="Show Selected Data"
            >
              ◀
            </button>
          )}
          {rightPanelOpen && hasActiveLayerSelection && (
            <aside className="dashboard-sidebar-right">
              <div className="selected-data-panel">
                <div className="selected-data-header-row">
                  <h5>Selected Data {activeSelectedSite && chartLoading && <span className="data-updating-badge">Updating…</span>}</h5>
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
                        <tr><td>LAT / LON</td><td className="coord-cell">{(activeSelectedSite.latitude ?? 0).toFixed(5)}, {(activeSelectedSite.longitude ?? 0).toFixed(5)}</td></tr>
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
                            return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(3) : '—';
                          };
                          const fmt = (n: number | undefined) => (n != null && !isNaN(n) ? n.toFixed(3) : '—');
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
                ) : (
                  <p className="text-muted">Click a marker on the map or select a site from the left sidebar to view data.</p>
                )}
              </div>
            </aside>
          )}
        </div>
      </div>
  );
};

export default DashboardPage;
