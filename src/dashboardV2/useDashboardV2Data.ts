import { useCallback, useEffect, useMemo, useState } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import { getNOAA21VIIRS7DayFromWFS, peekFirePoints, ensureFiresPrefetched, subscribeFirePoints, type FIRMSFirePoint } from '../services/firmsApi';
import {
  getAERONETDataAfrica,
  getAfricanAERONETSites,
  type AERONETSite,
  type AERONETAODVersion,
  type SiteAODMap,
} from '../services/aeronetApi';
import {
  getMERRA2LatestDate,
  getMERRA2StationsByDate,
  type MERRA2StationDailyRecord,
} from '../services/merra2Api';
import {
  getOpenAqArchiveInfo,
  getOpenAqLocations,
  getOpenAqStations,
  hasOpenAqPm25Value,
  mergeOpenAqStationValues,
  peekOpenAqStations,
  prefetchOpenAqHistorical,
  prefetchOpenAqNrt,
  refreshOpenAqStationsInBackground,
  skeletonStationsFromLocations,
  type OpenAqMapMode,
  type OpenAqStationRecord,
} from '../services/openaqApi';
import {
  filterAaqePointsByUtcDate,
  findNearestAAQEForecastInitDate,
  getAAQEForecastByDate,
  getAaqeForecastDaysAfterSelected,
  getDefaultAaqeTimeCodeFromUtc,
  type AAQEForecastPoint,
  type AaqeDisplayType,
} from '../services/aaqeForecastApi';
import {
  type AnalysisWorkflow,
  DASHBOARD_V2_WORKFLOWS,
  getDefaultProductId,
  getProductById,
  type DashboardV2LayerKey,
} from './config';
import {
  clampIsoDateToMerra2Archive,
} from './merra2PlotRange';
import {
  getPresetPlotRange,
  normalizeCustomPlotRange,
  plotRangeLabel,
} from './plotRange';
import {
  AFRICA_OVERVIEW_LOCATION,
  toMapFlyTo,
  type DashboardV2Location,
  type DashboardV2MapFlyTo,
} from './locations';
import type { PlotRangeMode, PlotRangePreset } from './types';
import { washuPeriodFromDate, loadWashUGrid, getWashUStationsByDate, getWashULatestDate, type WashUPeriod, type WashUStationDailyRecord } from '../services/washuApi';
import { loadMerra2DailyCube } from '../services/merra2GridCube';
import { formatDateMonthDayYear } from '../utils/dateFormat';
import {
  merra2DefaultDate,
  MERRA2_DEFAULT_DATE,
  openAqHistoricalDefaultDate,
  todayDefaultDate,
} from '../utils/dashboardDates';

export interface DashboardV2Selection {
  label: string;
  value?: number;
  unit?: string;
}

export function useDashboardV2Data() {
  const [workflow, setWorkflow] = useState<AnalysisWorkflow>('historical');
  const [activeLayers, setActiveLayers] = useState<DashboardV2LayerKey[]>(['aeronet']);
  const [primaryLayer, setPrimaryLayer] = useState<DashboardV2LayerKey>('aeronet');
  const [productId, setProductId] = useState(getDefaultProductId('historical'));
  const [heatProductId, setHeatProductId] = useState(getDefaultProductId('historical'));
  const [selectedDate, setSelectedDate] = useState<Dayjs>(() => todayDefaultDate());
  const [plotRangeMode, setPlotRangeMode] = useState<PlotRangeMode>('7D');
  const initialPlotRange = getPresetPlotRange(todayDefaultDate().format('YYYY-MM-DD'), '7D');
  const [plotStartDate, setPlotStartDate] = useState(initialPlotRange.startDate);
  const [plotEndDate, setPlotEndDate] = useState(initialPlotRange.endDate);
  const [appliedPlotRangeMode, setAppliedPlotRangeMode] = useState<PlotRangeMode>('7D');
  const [appliedPlotStartDate, setAppliedPlotStartDate] = useState(initialPlotRange.startDate);
  const [appliedPlotEndDate, setAppliedPlotEndDate] = useState(initialPlotRange.endDate);
  const [country, setCountry] = useState('Africa overview');
  const [city, setCity] = useState('— select country first —');
  const [mapFlyTo, setMapFlyTo] = useState<DashboardV2MapFlyTo | null>(null);
  const [stationNetwork, setStationNetwork] = useState('All station networks');
  const [showHeatMap, setShowHeatMap] = useState(true);
  const [heatMapOpacity, setHeatMapOpacity] = useState(78);
  const [showColorbar, setShowColorbar] = useState(true);
  const [showAeronetStations, setShowAeronetStations] = useState(true);
  const [forecastLeadHours, setForecastLeadHours] = useState(24);
  const [mapSelectionLabel, setMapSelectionLabel] = useState('Africa overview');
  const [selectedMetric, setSelectedMetric] = useState<DashboardV2Selection | null>(null);

  const [firePoints, setFirePoints] = useState<FIRMSFirePoint[]>(() => peekFirePoints() ?? []);
  const [fireLoading, setFireLoading] = useState(false);
  const [aeronetSites, setAeronetSites] = useState<AERONETSite[]>([]);
  const [aeronetLoading, setAeronetLoading] = useState(false);
  const [aeronetError, setAeronetError] = useState<string | null>(null);
  const [aeronetAodVersion, setAeronetAodVersion] = useState<AERONETAODVersion>(1.5);
  const [siteAodMap, setSiteAodMap] = useState<SiteAODMap>({});

  const [merra2Stations, setMerra2Stations] = useState<MERRA2StationDailyRecord[]>([]);
  const [merra2Loading, setMerra2Loading] = useState(false);
  const [merra2Error, setMerra2Error] = useState<string | null>(null);
  const [merra2Notice, setMerra2Notice] = useState<string | null>(null);
  const [merra2LatestDate, setMerra2LatestDate] = useState<string | null>(null);
  const [merra2DataDate, setMerra2DataDate] = useState<string | null>(null);
  const [merra2ShowStations, setMerra2ShowStations] = useState(true);
  const [merra2ShowGridOverlay, setMerra2ShowGridOverlay] = useState(true);
  const [merra2GridLoading, setMerra2GridLoading] = useState(false);
  const [merra2GridHour, setMerra2GridHour] = useState(12);
  const [merra2GridSource, setMerra2GridSource] = useState<'gesdisc' | 'sample' | null>(null);
  const [merra2GridFallbackReason, setMerra2GridFallbackReason] = useState<string | null>(null);

  const [washuPeriod, setWashuPeriod] = useState<WashUPeriod>('monthly');
  const [washuGridLoading, setWashuGridLoading] = useState(false);
  const [washuGridSource, setWashuGridSource] = useState<'satpm' | 'sample' | null>(null);
  const [washuGridFallbackReason, setWashuGridFallbackReason] = useState<string | null>(null);
  const [washuShowStations, setWashuShowStations] = useState(true);
  const [washuStationsLoading, setWashuStationsLoading] = useState(false);
  const [washuStationsError, setWashuStationsError] = useState<string | null>(null);
  const [washuStationsNotice, setWashuStationsNotice] = useState<string | null>(null);
  const [washuDataDate, setWashuDataDate] = useState<string | null>(null);
  const [washuLatestDate, setWashuLatestDate] = useState<string | null>(null);
  const [washuStations, setWashuStations] = useState<WashUStationDailyRecord[]>([]);

  const [openAqStations, setOpenAqStations] = useState<OpenAqStationRecord[]>([]);
  const [openAqLoading, setOpenAqLoading] = useState(false);
  const [openAqError, setOpenAqError] = useState<string | null>(null);
  const [openAqMonitorsOnly, setOpenAqMonitorsOnly] = useState(false);
  const [openAqArchiveCutoffDate, setOpenAqArchiveCutoffDate] = useState<string | null>(null);
  const [openAqMapModeOverride, setOpenAqMapModeOverride] = useState<OpenAqMapMode | null>(null);

  const [aaqeForecastPoints, setAaqeForecastPoints] = useState<AAQEForecastPoint[]>([]);
  const [aaqeForecastByDate, setAaqeForecastByDate] = useState<Record<string, AAQEForecastPoint[]>>({});
  const [aaqeForecastDate, setAaqeForecastDate] = useState<string | null>(null);
  const [aaqeLoading, setAaqeLoading] = useState(false);
  const [aaqeError, setAaqeError] = useState<string | null>(null);
  const [aaqeNotice, setAaqeNotice] = useState<string | null>(null);
  const [aaqeDisplayType, setAaqeDisplayType] = useState<AaqeDisplayType>('DAILY_AQI');
  const [aaqeTimeCode, setAaqeTimeCode] = useState('1330');
  const [aaqeInitDate, setAaqeInitDate] = useState<string | null>(null);
  const [aaqeForecastDayIndex, setAaqeForecastDayIndex] = useState(1);

  const workflowConfig = DASHBOARD_V2_WORKFLOWS[workflow];
  const layerOn = useCallback(
    (layer: DashboardV2LayerKey) => activeLayers.includes(layer),
    [activeLayers]
  );
  const activeLayer: DashboardV2LayerKey = primaryLayer;
  const activeProduct = useMemo(() => {
    const product = workflowConfig.products.find((p) => p.layer === primaryLayer);
    return product ?? getProductById(workflow, productId) ?? workflowConfig.products[0];
  }, [workflowConfig.products, primaryLayer, workflow, productId]);

  const openAqMapMode: OpenAqMapMode =
    openAqMapModeOverride ?? (workflow === 'historical' ? 'daily' : 'latest');

  const effectiveSelectedDate = selectedDate.isAfter(dayjs(), 'day') ? dayjs() : selectedDate;
  const effectiveSelectedDateStr = effectiveSelectedDate.format('YYYY-MM-DD');

  const effectivePlotRange = useMemo(() => {
    if (appliedPlotRangeMode !== 'custom') {
      return getPresetPlotRange(effectiveSelectedDateStr, appliedPlotRangeMode);
    }
    return (
      normalizeCustomPlotRange(appliedPlotStartDate, appliedPlotEndDate) ??
      getPresetPlotRange(effectiveSelectedDateStr, '7D')
    );
  }, [appliedPlotRangeMode, appliedPlotStartDate, appliedPlotEndDate, effectiveSelectedDateStr]);

  const effectivePlotRangeLabel = useMemo(
    () => plotRangeLabel(appliedPlotRangeMode),
    [appliedPlotRangeMode]
  );

  const plotRangePending = useMemo(
    () =>
      plotRangeMode !== appliedPlotRangeMode ||
      plotStartDate !== appliedPlotStartDate ||
      plotEndDate !== appliedPlotEndDate,
    [
      plotRangeMode,
      appliedPlotRangeMode,
      plotStartDate,
      appliedPlotStartDate,
      plotEndDate,
      appliedPlotEndDate,
    ]
  );

  const commitPlotRange = useCallback(
    (mode: PlotRangeMode, startDate: string, endDate: string) => {
      setAppliedPlotRangeMode(mode);
      setAppliedPlotStartDate(startDate);
      setAppliedPlotEndDate(endDate);
    },
    []
  );

  const setPlotRangePreset = useCallback(
    (preset: PlotRangePreset) => {
      setPlotRangeMode(preset);
      const range = getPresetPlotRange(effectiveSelectedDateStr, preset);
      setPlotStartDate(range.startDate);
      setPlotEndDate(range.endDate);
      commitPlotRange(preset, range.startDate, range.endDate);
    },
    [effectiveSelectedDateStr, commitPlotRange]
  );

  const setPlotStartDateCustom = useCallback((date: string) => {
    setPlotRangeMode('custom');
    setPlotStartDate(date);
  }, []);

  const setPlotEndDateCustom = useCallback((date: string) => {
    setPlotRangeMode('custom');
    setPlotEndDate(date);
  }, []);

  const applyPlotRange = useCallback(() => {
    if (plotRangeMode === 'custom') {
      const range =
        normalizeCustomPlotRange(plotStartDate, plotEndDate) ??
        getPresetPlotRange(effectiveSelectedDateStr, '7D');
      setPlotStartDate(range.startDate);
      setPlotEndDate(range.endDate);
      commitPlotRange('custom', range.startDate, range.endDate);
      return;
    }
    const range = getPresetPlotRange(effectiveSelectedDateStr, plotRangeMode);
    setPlotStartDate(range.startDate);
    setPlotEndDate(range.endDate);
    commitPlotRange(plotRangeMode, range.startDate, range.endDate);
  }, [plotRangeMode, plotStartDate, plotEndDate, effectiveSelectedDateStr, commitPlotRange]);

  useEffect(() => {
    if (appliedPlotRangeMode === 'custom') return;
    const range = getPresetPlotRange(effectiveSelectedDateStr, appliedPlotRangeMode);
    setAppliedPlotStartDate(range.startDate);
    setAppliedPlotEndDate(range.endDate);
    if (plotRangeMode !== 'custom') {
      setPlotRangeMode(appliedPlotRangeMode);
      setPlotStartDate(range.startDate);
      setPlotEndDate(range.endDate);
    }
  }, [effectiveSelectedDateStr, appliedPlotRangeMode, plotRangeMode]);

  const merra2RequestedDate = useMemo(
    () => clampIsoDateToMerra2Archive(effectiveSelectedDateStr, merra2LatestDate),
    [effectiveSelectedDateStr, merra2LatestDate]
  );

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

  const washuMapDate = useMemo(() => {
    const maxSupported = dayjs(MERRA2_DEFAULT_DATE, 'YYYY-MM-DD');
    return effectiveSelectedDate.isAfter(maxSupported, 'day') ? maxSupported : effectiveSelectedDate;
  }, [effectiveSelectedDate]);

  const washuPeriodParts = useMemo(
    () => washuPeriodFromDate(washuMapDate.format('YYYY-MM-DD')),
    [washuMapDate]
  );

  const washuPeriodLabel =
    washuPeriod === 'annual'
      ? String(washuPeriodParts.year)
      : `${washuPeriodParts.year}-${String(washuPeriodParts.month).padStart(2, '0')}`;

  const washuRequestedDate = washuMapDate.format('YYYY-MM-DD');

  const showMerra2Grid = showMERRA2PM25 && merra2ShowGridOverlay;
  const showWashuHeat = showWashU && showHeatMap;
  const showAaqeHeat = showAAQEForecast && showHeatMap;

  const aaqeForecastDateOptions = useMemo(() => {
    if (!showAAQEForecast) return [];
    return getAaqeForecastDaysAfterSelected(effectiveSelectedDateStr);
  }, [showAAQEForecast, effectiveSelectedDateStr]);

  const changeWorkflow = useCallback((next: AnalysisWorkflow) => {
    setWorkflow(next);
    const defaultProduct = getDefaultProductId(next);
    const defaultLayer = DASHBOARD_V2_WORKFLOWS[next].products.find((p) => p.id === defaultProduct)?.layer
      ?? 'aeronet';
    setActiveLayers([defaultLayer]);
    setPrimaryLayer(defaultLayer);
    setProductId(defaultProduct);
    setHeatProductId(defaultProduct);
    setOpenAqMapModeOverride(null);
    setMapSelectionLabel('Africa overview');
    setSelectedMetric(null);
    if (next === 'historical') {
      setMerra2ShowGridOverlay(true);
      setMerra2ShowStations(true);
      setWashuShowStations(true);
      setSelectedDate(todayDefaultDate());
    }
    if (next === 'nrt') {
      setSelectedDate(todayDefaultDate());
      setShowHeatMap(true);
    }
    if (next === 'forecast') {
      setShowHeatMap(true);
    }
  }, [merra2LatestDate]);

  const toggleLayer = useCallback(
    (layer: DashboardV2LayerKey) => {
      setActiveLayers((prev) => {
        const isOn = prev.includes(layer);
        if (isOn) {
          if (prev.length <= 1) return prev;
          setPrimaryLayer((p) => (p === layer ? prev.find((l) => l !== layer) ?? p : p));
          return prev.filter((l) => l !== layer);
        }

        const product = workflowConfig.products.find((p) => p.layer === layer);
        if (product) {
          setProductId(product.id);
          if (DASHBOARD_V2_WORKFLOWS[workflow].heatProducts.includes(product.id)) {
            setHeatProductId(product.id);
          }
          if (workflow === 'historical') {
            if (layer === 'merra2') {
              setSelectedDate(merra2DefaultDate(merra2LatestDate));
            } else if (layer === 'washu') {
              setSelectedDate(dayjs(MERRA2_DEFAULT_DATE, 'YYYY-MM-DD'));
            } else if (layer === 'openaq') {
              setSelectedDate(openAqHistoricalDefaultDate(openAqArchiveCutoffDate));
            } else if (layer === 'aeronet') {
              setSelectedDate(todayDefaultDate());
            }
          }
          if (layer === 'openaq' && workflow === 'nrt') {
            setSelectedDate(todayDefaultDate());
            setOpenAqMapModeOverride('latest');
          }
        }
        setPrimaryLayer(layer);
        return [...prev, layer];
      });
    },
    [workflow, workflowConfig.products, merra2LatestDate, openAqArchiveCutoffDate]
  );

  const selectProduct = useCallback(
    (nextProductId: string) => {
      const product = getProductById(workflow, nextProductId);
      if (!product) return;
      setProductId(nextProductId);
      if (DASHBOARD_V2_WORKFLOWS[workflow].heatProducts.includes(nextProductId)) {
        setHeatProductId(nextProductId);
      }
      setActiveLayers((prev) => (prev.includes(product.layer) ? prev : [...prev, product.layer]));
      setPrimaryLayer(product.layer);
      if (workflow !== 'historical') return;
      if (product.layer === 'merra2') {
        setSelectedDate(merra2DefaultDate(merra2LatestDate));
      } else if (product.layer === 'washu') {
        setSelectedDate(dayjs(MERRA2_DEFAULT_DATE, 'YYYY-MM-DD'));
      } else if (product.layer === 'openaq') {
        setSelectedDate(openAqHistoricalDefaultDate(openAqArchiveCutoffDate));
      } else if (product.layer === 'aeronet') {
        setSelectedDate(todayDefaultDate());
      }
    },
    [workflow, merra2LatestDate, openAqArchiveCutoffDate]
  );

  const navigateToLocation = useCallback((location: DashboardV2Location) => {
    setCountry(location.country);
    setCity(location.city);
    setMapSelectionLabel(location.label);
    setMapFlyTo(toMapFlyTo(location));
  }, []);

  const flyToAfricaOverview = useCallback(() => {
    navigateToLocation(AFRICA_OVERVIEW_LOCATION);
  }, [navigateToLocation]);

  const resetDashboard = useCallback(() => {
    changeWorkflow('historical');
    setSelectedDate(todayDefaultDate());
    setPlotRangeMode('7D');
    const range = getPresetPlotRange(todayDefaultDate().format('YYYY-MM-DD'), '7D');
    setPlotStartDate(range.startDate);
    setPlotEndDate(range.endDate);
    setAppliedPlotRangeMode('7D');
    setAppliedPlotStartDate(range.startDate);
    setAppliedPlotEndDate(range.endDate);
    setStationNetwork('All station networks');
    setShowHeatMap(true);
    setHeatMapOpacity(78);
    setShowColorbar(true);
    setShowAeronetStations(true);
    setForecastLeadHours(24);
    setSelectedMetric(null);
    navigateToLocation(AFRICA_OVERVIEW_LOCATION);
  }, [changeWorkflow, navigateToLocation]);

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

  useEffect(() => {
    if (aeronetSites.length > 0) return;
    let cancelled = false;
    setAeronetLoading(true);
    setAeronetError(null);
    getAfricanAERONETSites()
      .then((data) => {
        if (!cancelled) setAeronetSites(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setAeronetError(err instanceof Error ? err.message : 'Failed to load AERONET sites.');
        }
      })
      .finally(() => {
        if (!cancelled) setAeronetLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [aeronetSites.length]);

  useEffect(() => {
    let cancelled = false;
    getMERRA2LatestDate()
      .then((latest) => {
        if (!cancelled && latest.latestDate) setMerra2LatestDate(latest.latestDate);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

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

  // Snap to latest MERRA2 date once when parquet metadata arrives (Dashboard 1 parity).
  useEffect(() => {
    if (!merra2LatestDate || workflow !== 'historical' || !activeLayers.includes('merra2')) return;
    setSelectedDate(merra2DefaultDate(merra2LatestDate));
  }, [merra2LatestDate]);

  // When archive cutoff arrives while Historical OpenAQ is active, snap only provisional defaults.
  useEffect(() => {
    if (!openAqArchiveCutoffDate || workflow !== 'historical' || !activeLayers.includes('openaq')) return;
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
  }, [openAqArchiveCutoffDate, workflow, activeLayers]);

  const setMapValidDate = useCallback(
    (next: Dayjs) => {
      let clamped = next.isAfter(dayjs(), 'day') ? dayjs() : next;
      if (workflow === 'historical' && activeLayers.includes('washu')) {
        const maxWashu = dayjs(MERRA2_DEFAULT_DATE, 'YYYY-MM-DD');
        if (clamped.isAfter(maxWashu, 'day')) clamped = maxWashu;
      }
      if (merra2LatestDate && activeLayers.includes('merra2')) {
        const maxMerra2 = dayjs(merra2LatestDate, 'YYYY-MM-DD');
        if (clamped.isAfter(maxMerra2, 'day')) clamped = maxMerra2;
      }

      setSelectedDate(clamped);
      setMapSelectionLabel('Africa overview');
      setSelectedMetric(null);

      if (workflow === 'forecast') {
        const iso = clamped.format('YYYY-MM-DD');
        setAaqeForecastDate(iso);
        setAaqeForecastDayIndex(0);
      }
    },
    [workflow, activeLayers, merra2LatestDate]
  );

  useEffect(() => {
    if (!showAeronet) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      getAERONETDataAfrica(effectiveSelectedDateStr, effectiveSelectedDateStr, aeronetAodVersion)
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
  }, [showAeronet, effectiveSelectedDateStr, aeronetAodVersion]);

  useEffect(() => {
    if (!showMERRA2PM25 && !preloadHistoricalLayers) return;
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
        return;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const noDataForDate = /No station data found for date/i.test(message);
        if (!noDataForDate) {
          if (cancelled) return;
          setMerra2Stations([]);
          setMerra2Error(message || 'Failed to load MERRA2 stations.');
          setMerra2Loading(false);
          return;
        }
      }

      try {
        let latestDate = merra2LatestDate;
        if (!latestDate) {
          const latest = await getMERRA2LatestDate();
          latestDate = latest.latestDate;
          if (latestDate) setMerra2LatestDate(latestDate);
        }
        if (!latestDate) throw new Error('MERRA2 latest date unavailable.');
        const latestStations = await getMERRA2StationsByDate(latestDate);
        if (cancelled) return;
        setMerra2DataDate(latestDate);
        setMerra2Stations(latestStations);
        if (latestDate !== requestedDate) {
          setMerra2Notice(`Showing latest MERRA2 date ${latestDate} (no data for ${requestedDate}).`);
        }
      } catch (err: unknown) {
        if (cancelled) return;
        setMerra2Stations([]);
        setMerra2Error(err instanceof Error ? err.message : 'Failed to load MERRA2 stations.');
      } finally {
        if (!cancelled) setMerra2Loading(false);
      }
    };

    loadStations();
    return () => {
      cancelled = true;
    };
  }, [merra2RequestedDate, preloadHistoricalLayers, merra2LatestDate, showMERRA2PM25]);

  useEffect(() => {
    if (!showWashU && !preloadHistoricalLayers) return;
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
        return;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const noDataForDate = /No WashU station data found for date/i.test(message);
        if (!noDataForDate) {
          if (cancelled) return;
          setWashuStations([]);
          setWashuStationsError(message || 'Failed to load WashU stations.');
          setWashuStationsLoading(false);
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
        if (!latestDate) throw new Error('WashU latest parquet date is unavailable.');
        const latestStations = await getWashUStationsByDate(latestDate);
        if (cancelled) return;
        setWashuDataDate(latestDate);
        setWashuStations(latestStations);
        if (latestDate !== requestedDate) {
          setWashuStationsNotice(
            `No WashU station data for ${requestedDate}. Showing latest available date: ${latestDate}.`
          );
        }
      } catch (err: unknown) {
        if (cancelled) return;
        setWashuStations([]);
        setWashuStationsError(err instanceof Error ? err.message : 'Failed to load WashU stations.');
      } finally {
        if (!cancelled) setWashuStationsLoading(false);
      }
    };

    loadWashuStationData();
    return () => {
      cancelled = true;
    };
  }, [washuRequestedDate, preloadHistoricalLayers, washuLatestDate, showWashU]);

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
    let cancelled = false;
    setOpenAqError(null);
    setOpenAqLoading(true);

    const date = effectiveSelectedDateStr;
    const mode = openAqMapMode;
    const monitorsOnly = openAqMonitorsOnly;

    const applyColored = (locations: Awaited<ReturnType<typeof getOpenAqLocations>>, stations: OpenAqStationRecord[]) => {
      if (cancelled) return;
      const merged = mergeOpenAqStationValues(locations, stations, mode);
      setOpenAqStations(merged);
      if (merged.some(hasOpenAqPm25Value)) setOpenAqLoading(false);
    };

    let stopBackground: (() => void) | undefined;

    (async () => {
      try {
        const locations = await getOpenAqLocations(monitorsOnly);
        if (cancelled) return;

        const cached = peekOpenAqStations(date, mode, monitorsOnly);
        const cachedCount = cached?.filter(hasOpenAqPm25Value).length ?? 0;
        if (cached && cachedCount > 0) {
          applyColored(locations, cached);
        } else {
          setOpenAqStations(skeletonStationsFromLocations(locations, mode));
        }

        const stations = await getOpenAqStations(date, mode, monitorsOnly);
        if (cancelled) return;
        applyColored(locations, stations);

        stopBackground = refreshOpenAqStationsInBackground(date, mode, monitorsOnly, (enriched) => {
          applyColored(locations, enriched);
        });
      } catch (err) {
        if (cancelled) return;
        setOpenAqError(err instanceof Error ? err.message : 'Failed to load OpenAQ stations.');
        setOpenAqLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      stopBackground?.();
    };
  }, [preloadOpenAqLayers, effectiveSelectedDateStr, openAqMapMode, openAqMonitorsOnly]);

  useEffect(() => {
    if (showAAQEForecast) return;
    setAaqeNotice(null);
    setAaqeError(null);
  }, [showAAQEForecast]);

  useEffect(() => {
    if (!preloadForecastLayers) return;
    const requested = effectiveSelectedDateStr;
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
        setAaqeForecastDate(null);
        setAaqeInitDate(null);
        setAaqeError('No AAQE forecast file found within the last 30 days.');
        setAaqeLoading(false);
        return;
      }

      const initDate = nearest.initDate;
      const forecastDays = getAaqeForecastDaysAfterSelected(requested);
      if (nearest.wasAdjusted) {
        setAaqeNotice(`Using latest AAQE run ${initDate} (no file for ${requested}).`);
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
            const hit = filterAaqePointsByUtcDate(pool, iso);
            if (hit.length > 0) {
              pts = hit;
              break;
            }
          }
          byDateFinal[iso] = pts;
        }

        const defaultDay =
          forecastDays.find((d) => d.iso === requested) ?? forecastDays[0];
        setAaqeInitDate(initDate);
        setAaqeForecastDayIndex(defaultDay.dayIndex);
        setAaqeForecastByDate(byDateFinal);
        setAaqeForecastDate(defaultDay.iso);
        setAaqeForecastPoints(byDateFinal[defaultDay.iso] ?? []);
      } catch (err: unknown) {
        if (cancelled) return;
        setAaqeForecastByDate({});
        setAaqeForecastPoints([]);
        setAaqeForecastDate(null);
        setAaqeError(err instanceof Error ? err.message : 'Failed to load AAQE forecast.');
      } finally {
        if (!cancelled) setAaqeLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [preloadForecastLayers, effectiveSelectedDateStr]);

  useEffect(() => {
    if (!aaqeForecastDate) return;
    setAaqeForecastPoints(aaqeForecastByDate[aaqeForecastDate] ?? []);
  }, [aaqeForecastDate, aaqeForecastByDate]);

  const handleMapPointSelect = useCallback((selection: DashboardV2Selection) => {
    setMapSelectionLabel(selection.label);
    if (selection.value != null && Number.isFinite(selection.value)) {
      setSelectedMetric(selection);
      return;
    }
    setSelectedMetric(null);
  }, []);

  const resetMapSelection = useCallback(() => {
    setSelectedMetric(null);
    setMapSelectionLabel('Africa overview');
  }, []);

  const openAqDailyModeIsToday = useMemo(
    () => openAqMapMode === 'daily' && effectiveSelectedDateStr === dayjs().format('YYYY-MM-DD'),
    [openAqMapMode, effectiveSelectedDateStr]
  );

  const layerLoading =
    (showFires && fireLoading) ||
    (showAeronet && aeronetLoading) ||
    (showMERRA2PM25 && merra2Loading) ||
    (showWashU && washuGridLoading) ||
    (showWashU && washuShowStations && washuStationsLoading) ||
    (showOpenAq && openAqLoading) ||
    (showAAQEForecast && aaqeLoading) ||
    (showMerra2Grid && merra2GridLoading);

  const layerError = aeronetError || merra2Error || washuStationsError || openAqError || aaqeError;

  const contextChips = useMemo(() => {
    const chips = [workflowConfig.title.split(' ')[0], activeProduct.label];
    chips.push(formatDateMonthDayYear(effectiveSelectedDateStr));
    if (country !== 'Africa overview') chips.push(country);
    if (city && !city.startsWith('—')) chips.push(city);
    return chips;
  }, [workflowConfig.title, activeProduct.label, effectiveSelectedDateStr, country, city]);

  return {
    workflow,
    workflowConfig,
    productId,
    setProductId,
    selectProduct,
    toggleLayer,
    activeLayers,
    layerOn,
    primaryLayer,
    heatProductId,
    setHeatProductId,
    activeProduct,
    activeLayer,
    openAqMapMode,
    setOpenAqMapModeOverride,
    selectedDate,
    setSelectedDate,
    setMapValidDate,
    effectiveSelectedDateStr,
    plotRangeMode,
    setPlotRangePreset,
    applyPlotRange,
    plotRangePending,
    plotRangeLabel: effectivePlotRangeLabel,
    effectivePlotStartDate: effectivePlotRange.startDate,
    effectivePlotEndDate: effectivePlotRange.endDate,
    plotStartDate,
    setPlotStartDate: setPlotStartDateCustom,
    plotEndDate,
    setPlotEndDate: setPlotEndDateCustom,
    country,
    setCountry,
    city,
    setCity,
    stationNetwork,
    setStationNetwork,
    showHeatMap,
    setShowHeatMap,
    heatMapOpacity,
    setHeatMapOpacity,
    showColorbar,
    setShowColorbar,
    showAeronetStations,
    setShowAeronetStations,
    forecastLeadHours,
    setForecastLeadHours,
    mapSelectionLabel,
    setMapSelectionLabel,
    selectedMetric,
    showAeronet,
    showFires,
    showVIIRSImagery,
    showMERRA2PM25,
    showWashU,
    showOpenAq,
    showAAQEForecast,
    showMerra2Grid,
    showWashuHeat,
    showAaqeHeat,
    firePoints,
    fireLoading,
    aeronetSites,
    aeronetLoading,
    aeronetError,
    aeronetAodVersion,
    setAeronetAodVersion,
    siteAodMap,
    merra2Stations,
    merra2Loading,
    merra2Error,
    merra2Notice,
    merra2DataDate,
    merra2LatestDate,
    merra2ShowStations,
    setMerra2ShowStations,
    merra2ShowGridOverlay,
    setMerra2ShowGridOverlay,
    merra2GridLoading,
    setMerra2GridLoading,
    merra2GridHour,
    setMerra2GridHour,
    merra2GridSource,
    setMerra2GridSource,
    merra2GridFallbackReason,
    setMerra2GridFallbackReason,
    merra2RequestedDate,
    washuPeriod,
    setWashuPeriod,
    washuGridLoading,
    setWashuGridLoading,
    washuGridSource,
    setWashuGridSource,
    washuGridFallbackReason,
    setWashuGridFallbackReason,
    washuShowStations,
    setWashuShowStations,
    washuStations,
    washuStationsLoading,
    washuStationsError,
    washuStationsNotice,
    washuDataDate,
    washuRequestedDate,
    washuMapDate,
    washuPeriodParts,
    washuPeriodLabel,
    openAqDailyModeIsToday,
    openAqStations,
    openAqLoading,
    openAqError,
    openAqMonitorsOnly,
    setOpenAqMonitorsOnly,
    aaqeForecastPoints,
    aaqeForecastDate,
    setAaqeForecastDate,
    aaqeLoading,
    aaqeError,
    aaqeNotice,
    aaqeDisplayType,
    setAaqeDisplayType,
    aaqeTimeCode,
    setAaqeTimeCode,
    aaqeInitDate,
    aaqeForecastDayIndex,
    setAaqeForecastDayIndex,
    aaqeForecastDateOptions,
    aaqeForecastByDate,
    layerLoading,
    layerError,
    contextChips,
    changeWorkflow,
    resetDashboard,
    handleMapPointSelect,
    resetMapSelection,
    mapFlyTo,
    navigateToLocation,
    flyToAfricaOverview,
  };
}
