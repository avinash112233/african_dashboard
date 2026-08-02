import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import dayjs from 'dayjs';
import MapVisualization from '../components/maps/MapVisualization';
import type { PM25Sample } from '../components/maps/PM25HeatMapLayer';
import type { WashUPM25Sample } from '../components/maps/WashUPM25HeatMapLayer';
import { hasOpenAqPm25Value } from '../services/openaqApi';
import { calculateAQIFromPm25, getAqiCategory } from '../utils/aqiUtils';
import { formatDateMonthDayYear } from '../utils/dateFormat';
import {
  DASHBOARD_V2_CITIES,
  DASHBOARD_V2_COUNTRIES,
  DASHBOARD_V2_STATION_NETWORKS,
  PRODUCT_METADATA,
  isPointOnlyProduct,
  type AnalysisWorkflow,
  type DashboardV2LayerKey,
} from '../dashboardV2/config';
import DashboardV2AeronetControls from '../dashboardV2/DashboardV2AeronetControls';
import DashboardV2LayerToggles from '../dashboardV2/DashboardV2LayerToggles';
import DashboardV2PlottingPanel from '../dashboardV2/DashboardV2PlottingPanel';
import DashboardV2PlotStack from '../dashboardV2/DashboardV2PlotStack';
import DashboardV2MapLegend from '../dashboardV2/DashboardV2MapLegend';
import { useDashboardV2Data } from '../dashboardV2/useDashboardV2Data';
import { useDashboardV2LayerFeatures } from '../dashboardV2/useDashboardV2LayerFeatures';
import { getAODLevelColor, getAODLevelLabel } from '../utils/aodUtils';
import '../styles/aaqeDashboardV2.css';
import '../components/maps/MapVisualization.css';

const WORKFLOW_TABS: { id: AnalysisWorkflow; label: string; icon: string }[] = [
  { id: 'historical', label: 'Historical', icon: 'bi-clock-history' },
  { id: 'nrt', label: 'Near real time', icon: 'bi-satellite' },
  { id: 'forecast', label: 'Forecast', icon: 'bi-cloud-sun' },
];

const DashboardPageV2 = () => {
  const data = useDashboardV2Data();
  const [metaOpen, setMetaOpen] = useState(false);
  const [colorbarOpen, setColorbarOpen] = useState(false);
  const plotStackRef = useRef<HTMLDivElement>(null);

  const scrollPlotStackIntoView = useCallback(() => {
    requestAnimationFrame(() => {
      plotStackRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }, []);

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
    onSelectionMade: scrollPlotStackIntoView,
    plotStartDate: data.effectivePlotStartDate,
    plotEndDate: data.effectivePlotEndDate,
    plotRangeLabel: data.plotRangeLabel,
    washuMapYear: data.washuPeriodParts.year,
    washuMapMonth: data.washuPeriodParts.month,
  });

  const showAeronetTimeSeries = data.showAeronet && layers.selectedSite != null;

  useEffect(() => {
    if (showAeronetTimeSeries) scrollPlotStackIntoView();
  }, [showAeronetTimeSeries, layers.selectedSite?.site, scrollPlotStackIntoView]);

  const cityOptions = useMemo(
    () => DASHBOARD_V2_CITIES[data.country] ?? DASHBOARD_V2_CITIES['Africa overview'],
    [data.country]
  );

  const heatProducts = useMemo(
    () => data.workflowConfig.products.filter((p) => data.workflowConfig.heatProducts.includes(p.id)),
    [data.workflowConfig]
  );

  const productMeta = PRODUCT_METADATA[data.productId];
  const isAeronetHeatProduct =
    data.heatProductId === 'aeronet_aod' || data.productId === 'aeronet_aod';
  const isPointOnlyHeat = isPointOnlyProduct(data.heatProductId);
  const aeronetNetworkVisible =
    data.stationNetwork === 'All station networks' || data.stationNetwork === 'AERONET';
  const visibleAeronetSites = useMemo(() => {
    if (!data.showAeronet || !aeronetNetworkVisible) return [];
    return data.aeronetSites;
  }, [data.showAeronet, data.aeronetSites, aeronetNetworkVisible]);
  const mapShowAeronet = data.showAeronet && data.showAeronetStations && aeronetNetworkVisible;

  const mainMetricValue = data.selectedMetric?.value;
  const mainMetricUnit = data.selectedMetric?.unit ?? data.activeProduct.unit;
  const isAeronetMetric =
    data.productId === 'aeronet_aod' ||
    mainMetricUnit?.toLowerCase().includes('aod') ||
    data.activeProduct.id === 'aeronet_aod';
  const mainAqi = !isAeronetMetric && mainMetricValue != null ? calculateAQIFromPm25(mainMetricValue) : null;
  const mainAqiCat = getAqiCategory(mainAqi);
  const mainAodLevel = isAeronetMetric ? getAODLevelLabel(mainMetricValue) : '';
  const mainAodColor = isAeronetMetric ? getAODLevelColor(mainMetricValue) : undefined;
  const aqiFillPct =
    mainAqi != null ? Math.min(100, Math.max(8, Math.round((mainAqi / 300) * 100))) : 12;

  const readSiteAod500 = (siteId: string) => {
    const entry = data.siteAodMap[siteId];
    if (entry && 'hasData' in entry && entry.hasData) return entry.AOD_500nm;
    return undefined;
  };

  const aodMetric = layers.activeSelectedSite
    ? readSiteAod500(layers.activeSelectedSite.site)
    : layers.dailyMeanAod[layers.dailyMeanAod.length - 1]?.AOD_500nm ??
      (visibleAeronetSites.length > 0
        ? readSiteAod500(visibleAeronetSites[0].site)
        : undefined);
  const forecastMetricValue =
    data.workflow === 'forecast' ? data.selectedMetric?.value ?? null : null;
  const openAqWithData = data.openAqStations.filter(hasOpenAqPm25Value).length;
  const coveragePct =
    data.openAqStations.length > 0
      ? Math.round((openAqWithData / data.openAqStations.length) * 100)
      : visibleAeronetSites.length > 0
        ? Math.min(
            100,
            Math.round(
              (visibleAeronetSites.filter((s) => readSiteAod500(s.site) != null).length /
                visibleAeronetSites.length) *
                100
            )
          )
        : 86;

  const [washuPm25Sample, setWashuPm25Sample] = useState<WashUPM25Sample | null>(null);

  const handlePm25Sample = (sample: PM25Sample | null) => {
    if (sample) {
      data.handleMapPointSelect({
        label: `Grid (${sample.lat.toFixed(2)}°, ${sample.lon.toFixed(2)}°)`,
        value: sample.value,
        unit: sample.units || 'µg m⁻³',
      });
    }
  };

  const handleCountryChange = (country: string) => {
    data.setCountry(country);
    const cities = DASHBOARD_V2_CITIES[country] ?? DASHBOARD_V2_CITIES['Africa overview'];
    data.setCity(cities[0] ?? '— select country first —');
  };

  const handleResetMapFocus = () => {
    layers.clearAllSelections();
    data.resetMapSelection();
  };

  const handleToggleLayer = useCallback(
    (layer: DashboardV2LayerKey) => {
      if (data.layerOn(layer)) {
        layers.dismissLayerSelection(layer);
      }
      data.toggleLayer(layer);
    },
    [data, layers]
  );

  const activeLayerProducts = useMemo(() => {
    const byLayer = new Map<DashboardV2LayerKey, string>();
    for (const product of data.workflowConfig.products) {
      if (data.layerOn(product.layer) && !byLayer.has(product.layer)) {
        byLayer.set(product.layer, product.label);
      }
    }
    return [...byLayer.entries()].map(([layer, label]) => ({ layer, label }));
  }, [data.workflowConfig.products, data.activeLayers, data.layerOn]);

  const showMerra2Legend =
    data.showMERRA2PM25 && (data.showMerra2Grid || data.merra2ShowStations);

  const showFloatingLegend =
    data.showColorbar &&
    (showMerra2Legend || data.showWashuHeat || data.showAAQEForecast);

  return (
    <main className={`dashboard-v2-page workflow-${data.workflow}`}>
      <section className="panel-card common-panel">
        <div className="d-flex justify-content-between align-items-start gap-3 flex-wrap mb-2">
          <div>
            <div className="panel-title mb-2">
              <i className="bi bi-sliders" aria-hidden="true" /> Common analysis options
            </div>
            <div className="help-text">
              Select the workflow first. The product, heat-map, and plotting panels below show only options
              relevant to that workflow.
            </div>
          </div>
          <div className="d-flex gap-2 flex-wrap">
            <button type="button" className="btn btn-outline-aaqe" onClick={data.resetDashboard}>
              <i className="bi bi-arrow-counterclockwise me-1" aria-hidden="true" />
              Reset
            </button>
          </div>
        </div>

        <div className="row g-3 align-items-end">
          <div className="col-12">
            <label className="form-label">Analysis workflow</label>
            <div className="analysis-tabs" role="group" aria-label="Analysis workflow">
              {WORKFLOW_TABS.map(({ id, label, icon }) => (
                <button
                  key={id}
                  type="button"
                  className={`analysis-btn${data.workflow === id ? ' active' : ''}`}
                  onClick={() => {
                    data.changeWorkflow(id);
                    layers.clearAllSelections();
                  }}
                >
                  <i className={`bi ${icon}`} aria-hidden="true" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="col-md-3">
            <label className="form-label" htmlFor="v2-country">
              Country
            </label>
            <select
              id="v2-country"
              className="form-select"
              value={data.country}
              onChange={(e) => handleCountryChange(e.target.value)}
            >
              {DASHBOARD_V2_COUNTRIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="col-md-3">
            <label className="form-label" htmlFor="v2-city">
              City
            </label>
            <select
              id="v2-city"
              className="form-select"
              value={data.city}
              onChange={(e) => data.setCity(e.target.value)}
            >
              {cityOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="col-md-3">
            <label className="form-label" htmlFor="v2-station-network">
              Station network
            </label>
            <select
              id="v2-station-network"
              className="form-select"
              value={data.stationNetwork}
              onChange={(e) => data.setStationNetwork(e.target.value)}
            >
              {DASHBOARD_V2_STATION_NETWORKS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>

          <div className="col-md-3">
            <label className="form-label">Map / valid date</label>
            <DatePicker
              value={data.selectedDate}
              onChange={(d) => d && data.setMapValidDate(d)}
              maxDate={dayjs()}
              slotProps={{ textField: { size: 'small', fullWidth: true, className: 'form-control' } }}
            />
            <div className="mini-note mt-1">
              Map layers and daily products reload for{' '}
              {formatDateMonthDayYear(data.effectiveSelectedDateStr)}.
            </div>
          </div>

          {data.workflow === 'forecast' && (
            <div className="col-md-3 forecast-only">
              <label className="form-label d-flex justify-content-between">
                <span>Forecast lead time</span>
                <span>+{data.forecastLeadHours} h</span>
              </label>
              <input
                type="range"
                className="form-range"
                min={0}
                max={72}
                step={3}
                value={data.forecastLeadHours}
                onChange={(e) => data.setForecastLeadHours(Number(e.target.value))}
              />
            </div>
          )}

          <div className="col-md-6">
            <div className="d-flex flex-wrap gap-1">
              {data.contextChips.map((chip) => (
                <span key={chip} className="section-chip">
                  {chip}
                </span>
              ))}
              <span className="section-chip">{formatDateMonthDayYear(data.effectiveSelectedDateStr)}</span>
            </div>
          </div>
        </div>
      </section>

      <div className="row g-3">
        <aside className="col-12 col-xl-3">
          <div className="side-stack">
            <section className="panel-card">
              <div className="panel-title">
                <i className="bi bi-database" aria-hidden="true" /> Product panel
              </div>
              <label className="form-label" htmlFor="v2-product">
                Product for analysis
              </label>
              <select
                id="v2-product"
                className="form-select mb-2"
                value={data.productId}
                onChange={(e) => data.selectProduct(e.target.value)}
              >
                {data.workflowConfig.products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              <div className="mini-note mb-3">
                Pick a primary product for analysis. Use map overlays below to show or hide additional
                layers without cluttering the map.
              </div>

              <DashboardV2LayerToggles
                products={data.workflowConfig.products}
                activeLayers={data.activeLayers}
                primaryLayer={data.primaryLayer}
                onToggleLayer={handleToggleLayer}
              />

              <button
                type="button"
                className={`v2-accordion-btn${metaOpen ? ' open' : ''}`}
                onClick={() => setMetaOpen((o) => !o)}
              >
                Scientific metadata for selected product
              </button>
              {metaOpen && productMeta && (
                <div className="v2-accordion-body">
                  <dl>
                    <dt>Summary</dt>
                    <dd>{productMeta.short}</dd>
                    <dt>Temporal</dt>
                    <dd>{productMeta.temporal}</dd>
                    <dt>Resolution</dt>
                    <dd>{productMeta.resolution}</dd>
                    <dt>Use</dt>
                    <dd>{productMeta.use}</dd>
                  </dl>
                </div>
              )}

              {data.layerError && <p className="v2-error-note">{data.layerError}</p>}
              {data.layerLoading && <span className="v2-loading-pill">Loading map layers…</span>}
            </section>

            <section className="panel-card">
              <div className="panel-title">
                <i className="bi bi-map" aria-hidden="true" /> Heat-map panel
              </div>
              {heatProducts.length > 0 && (
                <>
                  <label className="form-label" htmlFor="v2-heat-product">
                    Heat-map product
                  </label>
                  <select
                    id="v2-heat-product"
                    className="form-select mb-2"
                    value={data.heatProductId}
                    onChange={(e) => data.selectProduct(e.target.value)}
                  >
                    {heatProducts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </>
              )}

              <div className="toggle-grid mb-3">
                <div className="form-check form-switch">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    id="v2-show-heat"
                    checked={data.showHeatMap}
                    disabled={isPointOnlyHeat}
                    onChange={(e) => data.setShowHeatMap(e.target.checked)}
                  />
                  <label className="form-check-label" htmlFor="v2-show-heat">
                    Show heat map
                  </label>
                </div>
                {data.showMERRA2PM25 && (
                  <>
                    <div className="form-check form-switch">
                      <input
                        className="form-check-input"
                        type="checkbox"
                        id="v2-merra2-stations"
                        checked={data.merra2ShowStations}
                        onChange={(e) => data.setMerra2ShowStations(e.target.checked)}
                      />
                      <label className="form-check-label" htmlFor="v2-merra2-stations">
                        MERRA2 stations
                      </label>
                    </div>
                    <div className="form-check form-switch">
                      <input
                        className="form-check-input"
                        type="checkbox"
                        id="v2-merra2-grid"
                        checked={data.merra2ShowGridOverlay}
                        onChange={(e) => data.setMerra2ShowGridOverlay(e.target.checked)}
                      />
                      <label className="form-check-label" htmlFor="v2-merra2-grid">
                        CNN PM2.5 grid
                      </label>
                    </div>
                  </>
                )}
              </div>

              {isPointOnlyHeat && (
                <div className="mini-note mb-2">
                  Overlay toggles only show or hide layers. Station-observation products display points
                  only, not heat maps.
                </div>
              )}

              {!isPointOnlyHeat && (
                <>
                  <label className="form-label d-flex justify-content-between">
                    <span>Heat-map opacity</span>
                    <span>{data.heatMapOpacity}%</span>
                  </label>
                  <input
                    type="range"
                    className="form-range"
                    min={20}
                    max={95}
                    step={5}
                    value={data.heatMapOpacity}
                    onChange={(e) => data.setHeatMapOpacity(Number(e.target.value))}
                  />
                </>
              )}

              <DashboardV2AeronetControls
                showAeronet={data.showAeronet}
                aeronetLoading={data.aeronetLoading}
                aeronetError={data.aeronetError}
                visibleSites={visibleAeronetSites}
                showAeronetStations={data.showAeronetStations}
                onShowAeronetStationsChange={data.setShowAeronetStations}
                aeronetAodVersion={data.aeronetAodVersion}
                onAeronetAodVersionChange={data.setAeronetAodVersion}
                selectedSiteId={layers.selectedSite?.site ?? ''}
                onSiteSelect={(site) => {
                  if (site) layers.handleAeronetSiteClick(site);
                  else layers.dismissAeronetSelection();
                }}
                isPointOnlyHeat={isPointOnlyHeat && isAeronetHeatProduct}
              />

              {data.showMERRA2PM25 && data.merra2ShowGridOverlay && (
                <div className="mt-2">
                  <label className="form-label d-flex justify-content-between">
                    <span>Grid hour (UTC)</span>
                    <span>{String(data.merra2GridHour).padStart(2, '0')}:00</span>
                  </label>
                  <input
                    type="range"
                    className="form-range"
                    min={0}
                    max={23}
                    value={data.merra2GridHour}
                    onChange={(e) => data.setMerra2GridHour(Number(e.target.value))}
                  />
                </div>
              )}

              <button
                type="button"
                className={`v2-accordion-btn mt-3${colorbarOpen ? ' open' : ''}`}
                onClick={() => setColorbarOpen((o) => !o)}
              >
                Optional color-bar customization
              </button>
              {colorbarOpen && (
                <div className="v2-accordion-body">
                  <div className="toggle-grid mb-2">
                    <div className="form-check form-switch">
                      <input
                        className="form-check-input"
                        type="checkbox"
                        id="v2-colorbar"
                        checked={data.showColorbar}
                        onChange={(e) => data.setShowColorbar(e.target.checked)}
                      />
                      <label className="form-check-label" htmlFor="v2-colorbar">
                        Show color bar
                      </label>
                    </div>
                  </div>
                  <div className="mini-note">Auto min-max uses current Africa-domain heat-map values.</div>
                </div>
              )}
            </section>

            <DashboardV2PlottingPanel data={data} layers={layers} />
          </div>
        </aside>

        <section className="col-12 col-xl-9 dashboard-v2-main-column">
          <div className="product-context-banner">
            <div>
              <h2>{data.workflowConfig.title}</h2>
              <p>{data.workflowConfig.description}</p>
            </div>
            <div className="d-flex flex-column align-items-end gap-2">
              <span className="section-chip">{data.activeProduct.label}</span>
              <span className="section-chip">
                {formatDateMonthDayYear(data.effectivePlotStartDate)} –{' '}
                {formatDateMonthDayYear(data.effectivePlotEndDate)}
              </span>
            </div>
          </div>

          <div className="metric-grid">
            <div className="metric-card">
              <div className="metric-label">Selected product value</div>
              <div className="metric-value">
                <span>
                  {mainMetricValue != null
                    ? isAeronetMetric
                      ? mainMetricValue.toFixed(2)
                      : mainMetricValue.toFixed(1)
                    : '—'}
                </span>
                <span className="metric-unit">{isAeronetMetric ? 'AOD' : mainMetricUnit}</span>
              </div>
              <div className="metric-caption">
                {isAeronetMetric ? (
                  <>
                    <span
                      className="status-dot"
                      style={{ background: mainAodColor ?? '#6e7f91' }}
                    />
                    {mainMetricValue != null ? mainAodLevel || 'AOD' : 'Click AERONET site'} at selected
                    focus
                  </>
                ) : (
                  <>
                    <span className="status-dot" style={{ background: mainAqiCat.color }} />
                    {mainMetricValue != null ? mainAqiCat.label : 'Click map feature'} at selected focus
                  </>
                )}
              </div>
              {!isAeronetMetric && (
                <div className="aq-index">
                  <div className="aq-fill" style={{ width: `${aqiFillPct}%` }} />
                </div>
              )}
            </div>
            <div className="metric-card">
              <div className="metric-label">Aerosol loading</div>
              <div className="metric-value">
                <span>{aodMetric != null ? Number(aodMetric).toFixed(2) : '—'}</span>
                <span className="metric-unit">AOD</span>
              </div>
              <div className="metric-caption">AERONET 550-nm context for selected site or date</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">
                {data.workflow === 'forecast' ? 'Forecast PM₂.₅' : 'Active layers'}
              </div>
              <div className="metric-value">
                {data.workflow === 'forecast' ? (
                  <>
                    <span>{forecastMetricValue != null ? forecastMetricValue.toFixed(0) : '—'}</span>
                    <span className="metric-unit">µg m⁻³</span>
                  </>
                ) : (
                  <>
                    <span>{data.activeLayers.length}</span>
                    <span className="metric-unit">on</span>
                  </>
                )}
              </div>
              <div className="metric-caption">
                {data.workflow === 'forecast'
                  ? `PM₂.₅ forecast at +${data.forecastLeadHours} h lead time`
                  : data.activeLayers.join(' · ')}
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Coverage</div>
              <div className="metric-value">
                <span>{coveragePct}</span>
                <span className="metric-unit">%</span>
              </div>
              <div className="metric-caption">Stations with readings for the selected map context</div>
            </div>
          </div>

          <div className="dashboard-v2-main-body">
          <div
            className={`map-card${showAeronetTimeSeries ? '' : ' dashboard-v2-map-card--expanded'}`}
          >
            <div className="map-toolbar floating-map-panel dashboard-v2-map-toolbar">
              <div className="fw-bold drag-handle">
                <i className="bi bi-grip-vertical me-1" aria-hidden="true" />
                <i className="bi bi-layers me-1" aria-hidden="true" />
                Interactive map view
              </div>
              <div className="mini-note mb-2">
                Click a station, fire hotspot, or grid cell to update metrics and plots below.
              </div>
              <div className="d-flex flex-wrap gap-1 mb-2">
                {data.contextChips.map((chip) => (
                  <span key={`map-${chip}`} className="section-chip">
                    {chip}
                  </span>
                ))}
              </div>
              {activeLayerProducts.length > 0 && (
                <div className="dashboard-v2-active-layer-chips mb-2" aria-label="Active map layers">
                  {activeLayerProducts.map(({ layer, label }) => {
                    const canRemove = data.activeLayers.length > 1;
                    return (
                      <span
                        key={layer}
                        className={`dashboard-v2-active-layer-chip${
                          data.primaryLayer === layer ? ' dashboard-v2-active-layer-chip--primary' : ''
                        }`}
                      >
                        {label}
                        {data.primaryLayer === layer && (
                          <span className="dashboard-v2-active-layer-chip-tag">Primary</span>
                        )}
                        {canRemove && (
                          <button
                            type="button"
                            className="dashboard-v2-active-layer-chip-remove"
                            aria-label={`Hide ${label} layer`}
                            onClick={() => handleToggleLayer(layer)}
                          >
                            ×
                          </button>
                        )}
                      </span>
                    );
                  })}
                </div>
              )}
              <div className="selection-info">
                <strong>Selected focus:</strong> {data.mapSelectionLabel}
              </div>
              <div className="map-panel-actions">
                <button type="button" className="btn btn-outline-aaqe" onClick={handleResetMapFocus}>
                  <i className="bi bi-arrow-counterclockwise me-1" aria-hidden="true" />
                  Reset point
                </button>
                <button type="button" className="btn btn-outline-aaqe" onClick={handleResetMapFocus}>
                  <i className="bi bi-crosshair me-1" aria-hidden="true" />
                  Fit focus
                </button>
              </div>
              <div className="panel-resize-note">Moveable · resizable</div>
            </div>

            <div className="dashboard-v2-map-wrap">
              <MapVisualization
                firePoints={data.firePoints}
                aeronetSites={visibleAeronetSites}
                siteAodMap={layers.derivedSiteAodMap}
                showFires={data.showFires}
                showAeronet={mapShowAeronet}
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
                merra2GridColorMode="aqi"
                merra2EnhancedLegend
                onPm25Sample={handlePm25Sample}
                showWashU={data.showWashuHeat}
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
                  setWashuPm25Sample(sample);
                  if (sample) {
                    data.handleMapPointSelect({
                      label: `WashU (${sample.lat.toFixed(2)}°, ${sample.lon.toFixed(2)}°)`,
                      value: sample.value,
                      unit: sample.units,
                    });
                  }
                }}
                showAAQEForecast={data.showAAQEForecast}
                showOpenAq={data.showOpenAq}
                openAqStations={data.openAqStations}
                onOpenAqStationClick={layers.handleOpenAqStationClick}
                selectedDate={data.effectiveSelectedDateStr}
                onFireClick={layers.handleFireClick}
                onAeronetSiteClick={layers.handleAeronetSiteClick}
                merra2Stations={data.merra2Stations}
                onMerra2StationClick={layers.handleMerra2StationClick}
                aaqeForecastPoints={data.aaqeForecastPoints}
                aaqeForecastTimeCode={data.aaqeTimeCode}
                aaqeDisplayType={data.aaqeDisplayType}
                aaqeForecastDate={data.aaqeForecastDate ?? undefined}
                onAAQEForecastClick={layers.handleAAQEForecastClick}
                fireChartRectDrawActive={layers.fireChartRectDrawActive}
                fireChartBounds={layers.fireChartBounds}
                onFireChartBoundsCommit={layers.handleFireChartBoundsCommit}
              />
            </div>

            {showFloatingLegend && (
              <div className="map-legend floating-map-panel dashboard-v2-map-legend">
                <DashboardV2MapLegend
                  workflow={data.workflow}
                  heatProductId={data.heatProductId}
                  showWashuHeat={data.showWashuHeat}
                  showMerra2Grid={data.showMerra2Grid}
                  showMerra2Stations={data.showMERRA2PM25 && data.merra2ShowStations}
                  showAaqeHeat={data.showAaqeHeat}
                  activeProductLabel={data.activeProduct.label}
                  activeProductUnit={data.activeProduct.unit}
                  washuPeriodLabel={data.washuPeriodLabel}
                  washuGridSource={data.washuGridSource}
                  washuSample={washuPm25Sample}
                  merra2GridSource={data.merra2GridSource}
                  merra2GridHour={data.merra2GridHour}
                />
              </div>
            )}

          </div>

          <div ref={plotStackRef} className="plot-stack dashboard-v2-plot-stack">
            <DashboardV2PlotStack data={data} layers={layers} />
          </div>
          </div>
        </section>
      </div>
    </main>
  );
};

export default DashboardPageV2;
