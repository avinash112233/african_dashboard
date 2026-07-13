import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import dayjs from 'dayjs';
import MapVisualization from '../components/maps/MapVisualization';
import type { AaqeDisplayType } from '../services/aaqeForecastApi';
import type { AERONETAODVersion } from '../services/aeronetApi';
import { hasOpenAqPm25Value } from '../services/openaqApi';
import { formatDateMonthDayYear } from '../utils/dateFormat';
import {
  DASHBOARD_V2_WORKFLOWS,
  type AnalysisWorkflow,
  type DashboardV2LayerKey,
} from '../dashboardV2/config';
import {
  DASHBOARD_V1_LAYER_LABELS,
  DASHBOARD_V1_LAYER_META,
  DASHBOARD_V1_WORKFLOW_META,
  DASHBOARD_V1_WORKFLOW_TABS,
} from '../dashboardV1/config';
import DashboardV2PlotStack from '../dashboardV2/DashboardV2PlotStack';
import { useDashboardV2Data } from '../dashboardV2/useDashboardV2Data';
import { useDashboardV2LayerFeatures } from '../dashboardV2/useDashboardV2LayerFeatures';
import {
  AaqeSelectedPanel,
  AeronetSelectedPanel,
  FireSelectedPanel,
  Merra2SelectedPanel,
  OpenAqSelectedPanel,
  WashUSelectedPanel,
} from '../dashboardV2/SelectedDataPanels';
import './DashboardPage.css';

const COMPACT_LAYOUT_MAX_PX = 1023;

const LAYER_ORDER: Record<AnalysisWorkflow, DashboardV2LayerKey[]> = {
  historical: ['aeronet', 'merra2', 'washu', 'openaq'],
  nrt: ['fires', 'viirs', 'openaq'],
  forecast: ['aaqe'],
};

const AAQE_TIME_OPTIONS = [
  { code: '130', label: '1:30 UTC' },
  { code: '430', label: '4:30 UTC' },
  { code: '730', label: '7:30 UTC' },
  { code: '1030', label: '10:30 UTC' },
  { code: '1330', label: '13:30 UTC' },
  { code: '1630', label: '16:30 UTC' },
  { code: '1930', label: '19:30 UTC' },
  { code: '2230', label: '22:30 UTC' },
];

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

const DashboardPageV2 = () => {
  const data = useDashboardV2Data();
  const [leftPanelOpen, setLeftPanelOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarPeek, setSidebarPeek] = useState(false);
  const isCompactLayout = useCompactLayout();

  const layers = useDashboardV2LayerFeatures({
    showAeronet: data.showAeronet,
    showFires: data.showFires,
    showMERRA2PM25: data.showMERRA2PM25,
    showWashU: data.showWashU,
    showOpenAq: data.showOpenAq,
    showAAQEForecast: data.showAAQEForecast,
    selectedDate: data.selectedDate,
    effectiveSelectedDateStr: data.effectiveSelectedDateStr,
    merra2RequestedDate: data.merra2RequestedDate,
    merra2LatestDate: data.merra2LatestDate ?? null,
    merra2Loading: data.merra2Loading,
    merra2DataDate: data.merra2DataDate,
    merra2Stations: data.merra2Stations,
    firePoints: data.firePoints,
    openAqMapMode: data.openAqMapMode,
    openAqMonitorsOnly: data.openAqMonitorsOnly,
    openAqLoading: data.openAqLoading,
    openAqStations: data.openAqStations,
    aaqeForecastByDate: data.aaqeForecastByDate,
    aaqeForecastDate: data.aaqeForecastDate,
    aaqeDisplayType: data.aaqeDisplayType,
    aaqeTimeCode: data.aaqeTimeCode,
    siteAodMap: data.siteAodMap,
    aeronetAodVersion: data.aeronetAodVersion,
    setAeronetAodVersion: data.setAeronetAodVersion,
    onMetricUpdate: data.handleMapPointSelect,
  });

  const openAqWithDataCount = useMemo(
    () => data.openAqStations.filter(hasOpenAqPm25Value).length,
    [data.openAqStations]
  );

  const workflowLayers = LAYER_ORDER[data.workflow];

  const getProductForLayer = useCallback(
    (layer: DashboardV2LayerKey) =>
      DASHBOARD_V2_WORKFLOWS[data.workflow].products.find((p) => p.layer === layer),
    [data.workflow]
  );

  const layerLoading = useCallback(
    (layer: DashboardV2LayerKey) => {
      switch (layer) {
        case 'aeronet':
          return data.aeronetLoading;
        case 'merra2':
          return data.merra2Loading;
        case 'openaq':
          return data.openAqLoading;
        case 'fires':
          return data.fireLoading;
        case 'washu':
          return data.washuGridLoading;
        case 'aaqe':
          return data.aaqeLoading;
        default:
          return false;
      }
    },
    [
      data.aeronetLoading,
      data.merra2Loading,
      data.openAqLoading,
      data.fireLoading,
      data.washuGridLoading,
      data.aaqeLoading,
    ]
  );

  const renderLayerToggle = (layer: DashboardV2LayerKey) => {
    const product = getProductForLayer(layer);
    if (!product) return null;
    const meta = DASHBOARD_V1_LAYER_META[layer];
    const loading = layerLoading(layer);
    const isActive = data.layerOn(layer);

    return (
      <label
        key={layer}
        className={`layer-checkbox d1-layer-option${isActive ? ' d1-layer-option--active' : ''}`}
        style={{ '--layer-accent': meta.color } as CSSProperties}
      >
        <input
          type="checkbox"
          checked={isActive}
          onChange={() => data.toggleLayer(layer)}
        />
        <span className="d1-layer-option-check" aria-hidden="true" />
        <span className="d1-layer-option-icon" aria-hidden="true">
          <i className={`bi ${meta.icon}`} />
        </span>
        <span className="d1-layer-option-label">
          {DASHBOARD_V1_LAYER_LABELS[layer]}
          {loading ? ' (loading…)' : ''}
        </span>
      </label>
    );
  };

  const activeLayerLabel = useMemo(() => {
    if (data.activeLayers.length <= 1) {
      return DASHBOARD_V1_LAYER_LABELS[data.primaryLayer];
    }
    return data.activeLayers.map((l) => DASHBOARD_V1_LAYER_LABELS[l]).join(' · ');
  }, [data.activeLayers, data.primaryLayer]);

  const closeMobileDrawers = useCallback(() => setLeftPanelOpen(false), []);

  const openAqPanelDate =
    layers.activeSelectedOpenAq?.datetime?.slice(0, 10) ||
    layers.activeSelectedOpenAq?.datetimeLast?.slice(0, 10) ||
    data.effectiveSelectedDateStr;

  return (
    <div className="dashboard-page dashboard-page-v1">
      <div className={`dashboard-layout${isCompactLayout ? ' dashboard-layout--compact' : ''}`}>
        {isCompactLayout && leftPanelOpen && (
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
            <div className="sidebar-section d1-sidebar-card">
              <h6 className="d1-section-label">Map date</h6>
              <DatePicker
                label="Selected date"
                value={data.selectedDate}
                onChange={(d) => d && data.setSelectedDate(d)}
                maxDate={dayjs()}
                slotProps={{ textField: { size: 'small', fullWidth: true } }}
              />
            </div>

            <div className="sidebar-section d1-sidebar-card">
              <h6 className="d1-section-label">Analysis workflow</h6>
              <div className="d1-workflow-tabs" role="group" aria-label="Analysis workflow">
                {DASHBOARD_V1_WORKFLOW_TABS.map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    className={`d1-workflow-btn${data.workflow === id ? ' active' : ''}`}
                    onClick={() => {
                      data.changeWorkflow(id);
                      layers.clearAllSelections();
                    }}
                  >
                    <i className={`bi ${DASHBOARD_V1_WORKFLOW_META[id].icon} d1-workflow-btn-icon`} aria-hidden="true" />
                    {label}
                  </button>
                ))}
              </div>
              <p className="d1-workflow-desc">{DASHBOARD_V1_WORKFLOW_META[data.workflow].description}</p>
            </div>

            <div className="sidebar-section d1-sidebar-card">
              <h6 className="d1-section-label">Data layers</h6>
              {workflowLayers.map((layer) => renderLayerToggle(layer))}

              {data.showAeronet && (
                <>
                  <div className="aeronet-aod-version aeronet-subcontrol">
                    <label style={{ fontSize: 12, color: '#666', fontWeight: 600, display: 'block', marginTop: 6 }}>
                      AOD Version
                    </label>
                    <select
                      className="site-select"
                      value={String(data.aeronetAodVersion)}
                      onChange={(e) =>
                        data.setAeronetAodVersion(Number(e.target.value) as AERONETAODVersion)
                      }
                    >
                      <option value="1">1.0 (AOD10)</option>
                      <option value="1.5">1.5 (AOD15)</option>
                      <option value="2">2.0 (AOD20)</option>
                    </select>
                  </div>
                  <div className="aeronet-date-range aeronet-subcontrol">
                    <DatePicker
                      label="From"
                      value={layers.aeronetDateFrom}
                      onChange={(d) => d && layers.setAeronetDateFrom(d)}
                      slotProps={{ textField: { size: 'small', fullWidth: true } }}
                    />
                    <DatePicker
                      label="To"
                      value={layers.aeronetDateTo}
                      onChange={(d) => d && layers.setAeronetDateTo(d)}
                      slotProps={{ textField: { size: 'small', fullWidth: true } }}
                    />
                    {layers.aeronetDateFrom.isAfter(layers.aeronetDateTo) && (
                      <small className="layer-tip" style={{ color: 'var(--warning, #b45309)' }}>
                        From is after To — using swapped range
                      </small>
                    )}
                  </div>
                  {data.aeronetSites.length > 0 && (
                    <select
                      className="site-select aeronet-subcontrol"
                      value={layers.selectedSite?.site ?? ''}
                      onChange={(e) => {
                        const site = data.aeronetSites.find((s) => s.site === e.target.value);
                        if (site) layers.handleAeronetSiteClick(site);
                      }}
                    >
                      <option value="">Select a site...</option>
                      {data.aeronetSites.map((s) => (
                        <option key={s.site} value={s.site}>
                          {s.name ?? s.site}
                        </option>
                      ))}
                    </select>
                  )}
                </>
              )}

              {data.showMERRA2PM25 && (
                <>
                  <div className="form-check form-switch d1-form-switch fire-subcontrol">
                    <input
                      className="form-check-input"
                      type="checkbox"
                      role="switch"
                      id="v2-merra2-stations"
                      checked={data.merra2ShowStations}
                      onChange={(e) => data.setMerra2ShowStations(e.target.checked)}
                    />
                    <label className="form-check-label" htmlFor="v2-merra2-stations">
                      Station markers
                    </label>
                  </div>
                  <div className="form-check form-switch d1-form-switch fire-subcontrol">
                    <input
                      className="form-check-input"
                      type="checkbox"
                      role="switch"
                      id="v2-merra2-grid"
                      checked={data.merra2ShowGridOverlay}
                      onChange={(e) => data.setMerra2ShowGridOverlay(e.target.checked)}
                    />
                    <label className="form-check-label" htmlFor="v2-merra2-grid">
                      CNN PM2.5 grid overlay
                    </label>
                  </div>
                  {data.merra2ShowStations && (
                    <small className="layer-tip">
                      Click a station for PM2.5 / AQI details. AQI scale on map when markers are on.
                    </small>
                  )}
                  {data.merra2Error && <small className="layer-tip layer-tip-warn">⚠ {data.merra2Error}</small>}
                  {data.merra2Notice && <small className="layer-tip">{data.merra2Notice}</small>}
                  {data.merra2ShowGridOverlay && (
                    <div className="aeronet-subcontrol" style={{ marginTop: 8 }}>
                      <label style={{ fontSize: 12, color: '#666', fontWeight: 600, display: 'block' }}>
                        Grid hour (UTC): {String(data.merra2GridHour).padStart(2, '0')}:00
                        {data.merra2GridLoading && ' · loading daily file…'}
                      </label>
                      <input
                        type="range"
                        min={0}
                        max={23}
                        step={1}
                        value={data.merra2GridHour}
                        onChange={(e) => data.setMerra2GridHour(Number(e.target.value))}
                        style={{ width: '100%', marginTop: 6 }}
                        aria-label="MERRA2 grid UTC hour"
                      />
                      <small className="layer-tip" style={{ display: 'block', marginTop: 4 }}>
                        Daily NetCDF has 24 hourly slices. Data loads once per date and caches in your browser.
                        Native 0.625°×0.5° cells — no interpolation.
                      </small>
                    </div>
                  )}
                  {data.merra2ShowGridOverlay && data.merra2GridSource === 'sample' && (
                    <small className="layer-tip layer-tip-warn">
                      ⚠ Grid showing sample data — check Earthdata credentials and restart backend
                      {data.merra2GridFallbackReason ? ` (${data.merra2GridFallbackReason})` : ''}.
                    </small>
                  )}
                </>
              )}

              {data.showWashU && (
                <>
                  <div className="aeronet-subcontrol" style={{ marginTop: 8 }}>
                    <label style={{ fontSize: 12, color: '#666', fontWeight: 600, display: 'block' }}>
                      Temporal product
                    </label>
                    <select
                      className="site-select"
                      style={{ marginTop: 4 }}
                      value={data.washuPeriod}
                      onChange={(e) => data.setWashuPeriod(e.target.value as 'monthly' | 'annual')}
                    >
                      <option value="monthly">Monthly mean</option>
                      <option value="annual">Annual mean</option>
                    </select>
                  </div>
                  <small className="layer-tip">
                    Select date sets {data.washuPeriod === 'monthly' ? 'year + month' : 'year'} (1998–2023). Showing{' '}
                    <strong>{data.washuPeriodLabel}</strong>. Click the map to pin a location for time series.
                  </small>
                  {data.washuGridSource === 'sample' && (
                    <small className="layer-tip layer-tip-warn">
                      ⚠ Grid showing sample data — SatPM download or Python worker failed
                      {data.washuGridFallbackReason ? ` (${data.washuGridFallbackReason})` : ''}.
                    </small>
                  )}
                </>
              )}

              {data.showOpenAq && data.workflow === 'historical' && (
                <>
                  <div className="form-check form-switch d1-form-switch fire-subcontrol">
                    <input
                      className="form-check-input"
                      type="checkbox"
                      role="switch"
                      id="v2-openaq-monitors-hist"
                      checked={data.openAqMonitorsOnly}
                      onChange={(e) => data.setOpenAqMonitorsOnly(e.target.checked)}
                    />
                    <label className="form-check-label" htmlFor="v2-openaq-monitors-hist">
                      Reference monitors only
                    </label>
                  </div>
                  <small className="layer-tip">Daily mean PM2.5 for the selected map date.</small>
                  {data.openAqDailyModeIsToday ? (
                    <small className="layer-tip layer-tip-warn">
                      Today isn&apos;t finished yet — pick yesterday or earlier for a daily mean.
                    </small>
                  ) : (
                    data.openAqStations.length > 0 && (
                      <small className="layer-tip">
                        {openAqWithDataCount} of {data.openAqStations.length} stations with PM2.5
                        {openAqWithDataCount === 0 && !data.openAqLoading ? ' for this date' : ''}.
                      </small>
                    )
                  )}
                  {data.openAqError && <small className="layer-tip layer-tip-warn">⚠ {data.openAqError}</small>}
                </>
              )}


              {data.showFires && (
                <>
                  <div className="form-check form-switch d1-form-switch fire-subcontrol">
                    <input
                      className="form-check-input"
                      type="checkbox"
                      role="switch"
                      id="v2-fire-rect"
                      checked={layers.fireChartRectDrawActive}
                      onChange={(e) => layers.setFireChartRectDrawActive(e.target.checked)}
                    />
                    <label className="form-check-label" htmlFor="v2-fire-rect">
                      Filter fire charts by rectangle (drag on map)
                    </label>
                  </div>
                  {layers.fireChartRectDrawActive && (
                    <small className="layer-tip">Drag on the map to set the chart region.</small>
                  )}
                  {layers.fireChartBounds && (
                    <button type="button" className="d1-btn-outline" onClick={layers.clearFireChartRectangle}>
                      Clear chart rectangle
                    </button>
                  )}
                </>
              )}

              {data.showVIIRSImagery && (
                <small className="layer-tip">NASA GIBS VIIRS NOAA-21 true-color imagery for the selected date.</small>
              )}

              {data.showOpenAq && data.workflow === 'nrt' && (
                <>
                  <div className="form-check form-switch d1-form-switch fire-subcontrol">
                    <input
                      className="form-check-input"
                      type="checkbox"
                      role="switch"
                      id="v2-openaq-monitors-nrt"
                      checked={data.openAqMonitorsOnly}
                      onChange={(e) => data.setOpenAqMonitorsOnly(e.target.checked)}
                    />
                    <label className="form-check-label" htmlFor="v2-openaq-monitors-nrt">
                      Reference monitors only
                    </label>
                  </div>
                  <small className="layer-tip">OpenAQ readings for the selected date only. No reading that day = gray.</small>
                  {data.openAqStations.length > 0 && (
                    <small className="layer-tip">
                      {openAqWithDataCount} of {data.openAqStations.length} stations with PM2.5.
                    </small>
                  )}
                  {data.openAqError && <small className="layer-tip layer-tip-warn">⚠ {data.openAqError}</small>}
                </>
              )}

              {data.showAAQEForecast && (
                <>
                  <small className="layer-tip">
                    Select Date = model initialization. Forecast dates: selected day + next 2 days.
                    {data.aaqeInitDate && ` Data run: ${formatDateMonthDayYear(data.aaqeInitDate)}.`}
                  </small>
                  <div className="aeronet-subcontrol" style={{ marginTop: 8 }}>
                    <label style={{ fontSize: 12, color: '#666', fontWeight: 600, display: 'block' }}>
                      Forecast Date
                    </label>
                    <select
                      className="site-select"
                      style={{ marginTop: 4 }}
                      value={data.aaqeForecastDayIndex}
                      onChange={(e) => {
                        const idx = Number(e.target.value);
                        data.setAaqeForecastDayIndex(idx);
                        const opt = data.aaqeForecastDateOptions.find((o) => o.dayIndex === idx);
                        if (opt) data.setAaqeForecastDate(opt.iso);
                      }}
                    >
                      {data.aaqeForecastDateOptions.map((d) => (
                        <option key={d.iso} value={d.dayIndex}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                    <label style={{ fontSize: 12, color: '#666', fontWeight: 600, display: 'block', marginTop: 8 }}>
                      Type
                    </label>
                    <select
                      className="site-select"
                      style={{ marginTop: 4 }}
                      value={data.aaqeDisplayType}
                      onChange={(e) => data.setAaqeDisplayType(e.target.value as AaqeDisplayType)}
                    >
                      <option value="DAILY_AQI">Daily AQI</option>
                      <option value="AQI">AQI</option>
                      <option value="PM">PM 2.5</option>
                    </select>
                    {data.aaqeDisplayType !== 'DAILY_AQI' && (
                      <>
                        <label style={{ fontSize: 12, color: '#666', fontWeight: 600, display: 'block', marginTop: 6 }}>
                          Time (UTC)
                        </label>
                        <select
                          className="site-select"
                          style={{ marginTop: 4 }}
                          value={data.aaqeTimeCode}
                          onChange={(e) => data.setAaqeTimeCode(e.target.value)}
                        >
                          {AAQE_TIME_OPTIONS.map((t) => (
                            <option key={t.code} value={t.code}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      </>
                    )}
                  </div>
                  {data.aaqeNotice && <small className="layer-tip">{data.aaqeNotice}</small>}
                  {data.aaqeError && <small className="layer-tip layer-tip-warn">⚠ {data.aaqeError}</small>}
                </>
              )}
            </div>
          </div>
        </aside>

        <main className="dashboard-map-area">
          <div className="d1-main-scroll">
            <div className="d1-map-context">
              <div className="d1-map-context-main">
                <span className="d1-map-context-workflow">
                  <i className={`bi ${DASHBOARD_V1_WORKFLOW_META[data.workflow].icon}`} aria-hidden="true" />
                  {DASHBOARD_V1_WORKFLOW_META[data.workflow].title}
                </span>
                <span
                  className="d1-map-context-layer"
                  style={{ '--layer-accent': DASHBOARD_V1_LAYER_META[data.primaryLayer].color } as CSSProperties}
                >
                  <i className={`bi ${DASHBOARD_V1_LAYER_META[data.primaryLayer].icon}`} aria-hidden="true" />
                  {activeLayerLabel}
                </span>
              </div>
              <span className="d1-map-context-date">
                <i className="bi bi-calendar3" aria-hidden="true" />
                {formatDateMonthDayYear(data.effectiveSelectedDateStr)}
              </span>
            </div>

            {isCompactLayout && (
              <div className="dashboard-mobile-controls">
                <button
                  type="button"
                  className={`dashboard-mobile-btn${leftPanelOpen ? ' dashboard-mobile-btn--active' : ''}`}
                  onClick={() => setLeftPanelOpen((open) => !open)}
                >
                  Layers
                </button>
              </div>
            )}

            <div className="d1-selected-data-top d1-plot-card">
              <div className="selected-data-header-row">
                <h5>
                  Selected Data
                  {layers.activeSelectedSite && layers.chartLoading && (
                    <span className="data-updating-badge"> Updating…</span>
                  )}
                </h5>
              </div>
              {layers.activeSelectedSite ? (
                <AeronetSelectedPanel
                  site={layers.activeSelectedSite}
                  chartData={layers.chartData}
                  chartLoading={layers.chartLoading}
                  aeronetStart={layers.aeronetDateFrom.format('YYYY-MM-DD')}
                  aeronetEnd={layers.aeronetDateTo.format('YYYY-MM-DD')}
                  onExportCsv={layers.exportAODCSV}
                />
              ) : layers.activeSelectedFire ? (
                <FireSelectedPanel fire={layers.activeSelectedFire} />
              ) : layers.activeSelectedMerra2Station ? (
                <Merra2SelectedPanel
                  station={layers.activeSelectedMerra2Station}
                  aqi={layers.selectedMerra2Aqi}
                  dataDate={layers.merra2PanelDataDate}
                  metricsLoading={layers.merra2PanelMetricsLoading}
                />
              ) : layers.activeSelectedWashU ? (
                <WashUSelectedPanel
                  lat={layers.activeSelectedWashU.lat}
                  lon={layers.activeSelectedWashU.lon}
                  periodLabel={data.washuPeriodLabel}
                  pm25={layers.activeSelectedWashU.pm25}
                  loading={data.washuGridLoading}
                />
              ) : layers.activeSelectedOpenAq ? (
                <OpenAqSelectedPanel
                  station={layers.activeSelectedOpenAq}
                  aqi={layers.selectedOpenAqAqi}
                  dataDate={openAqPanelDate}
                  metricsLoading={data.openAqLoading}
                />
              ) : layers.activeSelectedAAQE ? (
                <AaqeSelectedPanel data={layers.activeSelectedAAQE} threeDayRows={layers.aaqeThreeDayRows} />
              ) : (
                <div className="d1-empty-state">
                  <span className="d1-empty-state-icon" aria-hidden="true">
                    <i className="bi bi-cursor" />
                  </span>
                  <div>
                    <p className="d1-empty-state-title">No location selected</p>
                    <p className="d1-empty-state-hint">
                      Click a marker on the map or pick a site from the layers panel to see readings here.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {data.aeronetError && (
              <div className="aeronet-error-bar d1-alert-bar" role="alert">
                AERONET API Error: {data.aeronetError}
              </div>
            )}

            <div className="map-card d1-map-card">
              {data.showFires && data.fireLoading && (
                <div className="map-loading-overlay map-loading-overlay--bottom-right">
                  <div className="spinner-border spinner-border-sm text-primary" role="status" aria-hidden="true" />
                  <p className="map-loading-text map-loading-text--small">Loading fire…</p>
                </div>
              )}
              {data.showMerra2Grid && data.merra2GridLoading && (
                <div className="map-loading-overlay map-loading-overlay--bottom-right" aria-live="polite">
                  <div className="spinner-border spinner-border-sm text-primary" role="status" aria-hidden="true" />
                  <p className="map-loading-text map-loading-text--small">Loading CNN PM2.5 grid…</p>
                </div>
              )}
              {data.showMERRA2PM25 && data.merra2ShowStations && data.merra2Loading && data.merra2Stations.length === 0 && (
                <div className="map-loading-overlay map-loading-overlay--bottom-right" aria-live="polite">
                  <div className="spinner-border spinner-border-sm text-primary" role="status" aria-hidden="true" />
                  <p className="map-loading-text map-loading-text--small">Loading MERRA2 stations…</p>
                </div>
              )}
              {data.showWashU && data.washuGridLoading && (
                <div className="map-loading-overlay map-loading-overlay--bottom-right" aria-live="polite">
                  <div className="spinner-border spinner-border-sm text-primary" role="status" aria-hidden="true" />
                  <p className="map-loading-text map-loading-text--small">Loading WashU SatPM2.5 grid…</p>
                </div>
              )}
              {data.showOpenAq && data.openAqLoading && data.openAqStations.length === 0 && (
                <div className="map-loading-overlay map-loading-overlay--bottom-right" aria-live="polite">
                  <div className="spinner-border spinner-border-sm text-primary" role="status" aria-hidden="true" />
                  <p className="map-loading-text map-loading-text--small">Loading OpenAQ stations…</p>
                </div>
              )}

              <div className="dashboard-v1-map-wrap">
                <div className="map-container">
                  <MapVisualization
                    firePoints={data.firePoints}
                    aeronetSites={data.aeronetSites}
                    siteAodMap={layers.derivedSiteAodMap}
                    showFires={data.showFires}
                    showAeronet={data.showAeronet}
                    showVIIRSImagery={data.showVIIRSImagery}
                    showMERRA2PM25={data.showMERRA2PM25}
                    showMerra2Stations={data.showMERRA2PM25 && data.merra2ShowStations}
                    showMerra2GridOverlay={data.showMerra2Grid}
                    merra2GridDate={data.merra2RequestedDate}
                    merra2GridHour={data.merra2GridHour}
                    onMerra2GridLoadingChange={data.setMerra2GridLoading}
                    onMerra2GridSourceChange={(source, reason) => {
                      data.setMerra2GridSource(source);
                      data.setMerra2GridFallbackReason(reason ?? null);
                    }}
                    merra2GridSource={data.merra2GridSource}
                    showWashU={data.showWashU}
                    washuPeriod={data.washuPeriod}
                    washuYear={data.washuPeriodParts.year}
                    washuMonth={data.washuPeriod === 'monthly' ? data.washuPeriodParts.month : null}
                    washuPeriodLabel={data.washuPeriodLabel}
                    onWashuGridLoadingChange={data.setWashuGridLoading}
                    onWashuGridSourceChange={(source, reason) => {
                      data.setWashuGridSource(source);
                      data.setWashuGridFallbackReason(reason ?? null);
                    }}
                    washuGridSource={data.washuGridSource}
                    onWashuMapClick={layers.handleWashuMapClick}
                    onWashuPm25Sample={(sample) => {
                      if (sample) layers.updateWashuPm25Sample(sample.value);
                    }}
                    showAAQEForecast={data.showAAQEForecast}
                    showOpenAq={data.showOpenAq}
                    openAqStations={data.openAqStations}
                    onOpenAqStationClick={layers.handleOpenAqStationClick}
                    selectedDate={data.effectiveSelectedDateStr}
                    onFireClick={layers.handleFireClick}
                    onAeronetSiteClick={layers.handleAeronetSiteClick}
                    circleCenter={layers.circleCenter}
                    circleRadiusKm={layers.circleRadiusKm}
                    circleSelectActive={layers.circleSelectActive}
                    onCircleCenterChange={layers.handleCircleCenterChange}
                    onCircleClose={layers.handleCircleClose}
                    pointsInCircle={layers.pointsInSelection}
                    fireChartRectDrawActive={layers.fireChartRectDrawActive}
                    fireChartBounds={layers.fireChartBounds}
                    onFireChartBoundsCommit={layers.handleFireChartBoundsCommit}
                    merra2Stations={data.merra2Stations}
                    onMerra2StationClick={layers.handleMerra2StationClick}
                    aaqeForecastPoints={data.aaqeForecastPoints}
                    aaqeForecastTimeCode={data.aaqeTimeCode}
                    aaqeDisplayType={data.aaqeDisplayType}
                    aaqeForecastDate={data.aaqeForecastDate ?? undefined}
                    onAAQEForecastClick={layers.handleAAQEForecastClick}
                  />
                </div>
              </div>
            </div>

            <div className="d1-charts-stack">
              <DashboardV2PlotStack data={data} layers={layers} />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default DashboardPageV2;
