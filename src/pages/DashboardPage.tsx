import { useState, useEffect, useCallback } from 'react';
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
import { TimeSeriesChart, ScatterPlotChart, WavelengthBarChart } from '../components/charts';
import { normalizeAeronetDate, formatDateMonthDayYear, formatDisplayDate } from '../utils/dateFormat';
import { computeDailyMeanAOD, getAODLevelColor, getAODLevelLabel, AOD_CLASSIFICATION_LEGEND } from '../utils/aodUtils';
import type { PM25Sample } from '../components/maps/PM25HeatMapLayer';
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
  const [selectedPm25, setSelectedPm25] = useState<PM25Sample | null>(null);
  const [circleSelectActive, setCircleSelectActive] = useState(false);
  const [circleCenter, setCircleCenter] = useState<[number, number] | null>(null);
  const [circleRadiusKm, setCircleRadiusKm] = useState(5);
  const [fireLoading, setFireLoading] = useState(false);
  const [merra2Loading, setMerra2Loading] = useState(false);
  const [merra2DataSource, setMerra2DataSource] = useState<'gesdisc' | 'sample' | null>(null);
  const [merra2FallbackReason, setMerra2FallbackReason] = useState<string | null>(null);
  const [merra2RenderMode, setMerra2RenderMode] = useState<'smooth' | 'raw'>('smooth');
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

  const getDateRange = (selectedDateStr: string, range: AnalysisRange): { startDate: string; endDate: string } => {
    const end = dayjs(selectedDateStr, 'YYYY-MM-DD').startOf('day');
    const days = range === '7D' ? 7 : range === '30D' ? 30 : 90;
    // Inclusive range (last N days ending on selectedDate)
    const start = end.subtract(days - 1, 'day');
    return { startDate: start.format('YYYY-MM-DD'), endDate: end.format('YYYY-MM-DD') };
  };

  const effectiveSelectedDate = selectedDate.isAfter(dayjs(), 'day') ? dayjs() : selectedDate;
  const effectiveSelectedDateStr = effectiveSelectedDate.format('YYYY-MM-DD');
  const { startDate: analysisStartDate, endDate: analysisEndDate } = getDateRange(effectiveSelectedDateStr, analysisRange);
  const analysisRangeLabel =
    analysisRange === '7D' ? 'Last 7 Days' : analysisRange === '30D' ? 'Last 30 Days' : 'Last 90 Days';

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

  const handlePm25Sample = (sample: PM25Sample | null) => {
    setSelectedPm25(sample);
    if (sample) {
      setSelectedSite(null);
      setSelectedFire(null);
      setChartData([]);
      setRightPanelOpen(true);
    }
  };

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

  const pointsInCircle = (() => {
    if (!circleCenter) return [];
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
  })();


  const handleAeronetSiteClick = useCallback((site: AERONETSite) => {
    setSelectedSite(site);
    setSelectedFire(null);
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

  const switchLayer = useCallback((next: LayerMode) => {
    setActiveLayer((prev) => {
      if (prev === next) return prev;
      if (prev === 'fires') {
        setCircleSelectActive(false);
        setCircleCenter(null);
      }
      if (prev === 'merra2') {
        setMerra2DataSource(null);
        setMerra2FallbackReason(null);
        setMerra2Loading(false);
      }
      return next;
    });
  }, []);

  const handleMerra2SourceChange = useCallback((source: 'gesdisc' | 'sample', fallbackReason?: string) => {
    setMerra2DataSource(source);
    setMerra2FallbackReason(fallbackReason ?? null);
  }, []);

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
                <div className="aeronet-aod-version">
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
                <div className="aeronet-date-range">
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
                    className="site-select"
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
                  <small className="layer-tip">Gray = no data · Color = AOD level (green→yellow→orange→red)</small>
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
                  <label className="layer-checkbox">
                    <input
                      type="checkbox"
                      checked={circleSelectActive}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setCircleSelectActive(checked);
                        if (!checked) setCircleCenter(null);
                      }}
                    />
                    Select area (click map to draw circle)
                  </label>
                  {circleSelectActive && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                      <label style={{ fontSize: 12 }}>
                        Radius (km):{' '}
                        <select
                          value={circleRadiusKm}
                          onChange={(e) => setCircleRadiusKm(Number(e.target.value))}
                          style={{ padding: '2px 6px', fontSize: 12 }}
                        >
                          {[5, 10, 25, 50, 100].map((r) => (
                            <option key={r} value={r}>{r} km</option>
                          ))}
                        </select>
                      </label>
                      {circleCenter && (
                        <button type="button" onClick={() => setCircleCenter(null)} style={{ padding: '2px 8px', fontSize: 11 }}>
                          Clear
                        </button>
                      )}
                    </div>
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
                MERRA2 PM2.5 {merra2Loading && '(loading…)'}
              </label>
              {showMERRA2PM25 && (
                <>
                  <small className="layer-tip">
                    Surface PM2.5 · GES DISC HAQAST (2000–2024) · Uses selected date · Map colors use a 0–100 µg/m³ Reds-style scale (like daily MERRA2 CNN figures)
                  </small>
                  <label className="layer-checkbox">
                    <span style={{ marginRight: 8 }}>Rendering:</span>
                    <select
                      value={merra2RenderMode}
                      onChange={(e) => setMerra2RenderMode(e.target.value as 'smooth' | 'raw')}
                      style={{ padding: '2px 6px', fontSize: 12 }}
                    >
                      <option value="smooth">Smooth heatmap</option>
                      <option value="raw">Raw grid</option>
                    </select>
                  </label>
                  {selectedDate.year() > 2024 && (
                    <small className="layer-tip layer-tip-warn">
                      ⚠ Date outside 2000–2024 range.{' '}
                      {merra2DataSource === 'gesdisc'
                        ? 'Showing nearest available date.'
                        : 'Showing sample data.'}
                    </small>
                  )}
                  {merra2DataSource === 'sample' && selectedDate.year() <= 2024 && (
                    <small className="layer-tip layer-tip-warn">
                      {merra2FallbackReason === 'opendap_401_unauthorized'
                        ? '⚠ NASA Earthdata authorization failed (401). Showing sample data.'
                        : '⚠ Backend unavailable or remote fetch failed. Showing sample data.'}
                    </small>
                  )}
                </>
              )}
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
            {merra2Loading && !fireLoading && (
              <div className="map-loading-overlay">
                <div className="spinner-border text-primary" role="status" aria-hidden="true" />
                <p className="map-loading-text">Loading PM2.5 data…</p>
              </div>
            )}
            <div className="map-container">
              <MapVisualization
                firePoints={firePoints}
                aeronetSites={aeronetSites}
                siteAodMap={
                  Object.keys(siteAodMap).length > 0
                    ? siteAodMap
                    : selectedSite && chartData.length > 0
                      ? { [selectedSite.site]: { hasData: true }, [selectedSite.name ?? '']: { hasData: true } }
                      : siteAodMap
                }
                showFires={showFires}
                showAeronet={showAeronet}
                showVIIRSImagery={showVIIRSImagery}
                showMERRA2PM25={showMERRA2PM25}
                merra2RenderMode={merra2RenderMode}
                merra2Loading={merra2Loading}
                onPm25Sample={handlePm25Sample}
                onMerra2LoadingChange={setMerra2Loading}
                onMerra2SourceChange={handleMerra2SourceChange}
                selectedDate={
                  selectedDate.isAfter(dayjs(), 'day')
                    ? dayjs().format('YYYY-MM-DD')
                    : selectedDate.format('YYYY-MM-DD')
                }
                onFireClick={handleFireClick}
                onAeronetSiteClick={handleAeronetSiteClick}
                circleCenter={circleCenter}
                circleRadiusKm={circleRadiusKm}
                circleSelectActive={circleSelectActive}
                onCircleCenterChange={(lat, lng) => setCircleCenter([lat, lng])}
                onCircleClose={() => {
                  setCircleCenter(null);
                  setCircleSelectActive(false);
                }}
                pointsInCircle={pointsInCircle}
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
                          data={computeDailyMeanAOD(chartData)}
                          startDate={dayjs(analysisStartDate)}
                          endDate={dayjs(analysisEndDate)}
                        />
                      </div>
                    </div>
                    <div className="chart-box">
                      <div className="chart-container" key={`scatter-${selectedSite?.site ?? ''}`}>
                        <ScatterPlotChart data={computeDailyMeanAOD(chartData)} />
                      </div>
                    </div>
                    <div className="chart-box">
                      <div className="chart-container" key={`wavelength-${selectedSite?.site ?? ''}`}>
                        <WavelengthBarChart data={computeDailyMeanAOD(chartData)} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </main>

          {/* Right sidebar - Selected Data (show reopen only when something is selected) */}
          {!rightPanelOpen && (selectedSite || selectedFire || selectedPm25) && (
            <button
              type="button"
              className="panel-reopen-btn"
              onClick={() => setRightPanelOpen(true)}
              title="Show Selected Data"
            >
              ◀
            </button>
          )}
          {rightPanelOpen && (
            <aside className="dashboard-sidebar-right">
              <div className="selected-data-panel">
                <div className="selected-data-header-row">
                  <h5>Selected Data {selectedSite && chartLoading && <span className="data-updating-badge">Updating…</span>}</h5>
                  <button
                    type="button"
                    className="panel-close-btn"
                    onClick={() => setRightPanelOpen(false)}
                    aria-label="Close panel"
                  >
                    ×
                  </button>
                </div>
                {selectedSite ? (
                  <div className="selected-site-details">
                    <p className="data-source">AERONET Site</p>
                    <table className="selected-data-table">
                      <tbody>
                        <tr><td>NAME</td><td>{selectedSite.name ?? selectedSite.site}</td></tr>
                        <tr><td>SITE ID</td><td>{selectedSite.site}</td></tr>
                        <tr><td>DATE RANGE</td><td>{formatDateMonthDayYear(aeronetStart.format('YYYY-MM-DD'))} – {formatDateMonthDayYear(aeronetEnd.format('YYYY-MM-DD'))}</td></tr>
                        <tr><td>LAT / LON</td><td className="coord-cell">{(selectedSite?.latitude ?? 0).toFixed(5)}, {(selectedSite?.longitude ?? 0).toFixed(5)}</td></tr>
                        {selectedSite.elevation != null && (
                          <tr><td>ELEVATION</td><td>{selectedSite.elevation!.toFixed(0)} m</td></tr>
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
                    {selectedSite && chartData.length > 0 && (
                      <>
                        <button type="button" className="export-csv-btn" onClick={exportAODCSV}>
                          Export CSV
                        </button>
                        <p className="data-source-footer">AOD time series and wavelength charts below</p>
                      </>
                    )}
                  </div>
                ) : selectedFire ? (
                  <div className="selected-fire-details">
                    <p className="data-source">VIIRS / NOAA-21 [375m]</p>
                    <table className="selected-data-table">
                      <tbody>
                        <tr><td>LATITUDE</td><td>{selectedFire.latitude.toFixed(5)}</td></tr>
                        <tr><td>LONGITUDE</td><td>{selectedFire.longitude.toFixed(5)}</td></tr>
                        <tr><td>BRIGHT_TI4</td><td>{selectedFire.bright_ti4.toFixed(2)}</td></tr>
                        <tr><td>BRIGHT_TI5</td><td>{(selectedFire.bright_ti5 ?? 0).toFixed(2)}</td></tr>
                        <tr><td>SCAN</td><td>{selectedFire.scan}</td></tr>
                        <tr><td>TRACK</td><td>{selectedFire.track}</td></tr>
                        <tr><td>ACQUIRE TIME</td><td>{selectedFire.acq_date} {selectedFire.acq_time}</td></tr>
                        <tr><td>SATELLITE</td><td>{selectedFire.satellite}</td></tr>
                        <tr><td>INSTRUMENT</td><td>{selectedFire.instrument}</td></tr>
                        <tr><td>CONFIDENCE</td><td>{selectedFire.confidence || 'nominal'}</td></tr>
                        <tr><td>VERSION</td><td>{selectedFire.version || '2.0NRT'}</td></tr>
                        <tr><td>FRP</td><td>{selectedFire.frp?.toFixed(2) ?? 'N/A'}</td></tr>
                        <tr><td>DAYNIGHT</td><td>{selectedFire.daynight === 'D' ? 'D' : selectedFire.daynight === 'N' ? 'N' : selectedFire.daynight}</td></tr>
                      </tbody>
                    </table>
                    <p className="data-source-footer">Source: NASA FIRMS (VIIRS NOAA-21)</p>
                  </div>
                ) : selectedPm25 ? (
                  <div className="selected-pm25-details">
                    <p className="data-source">MERRA2 PM2.5 (CNN HAQAST)</p>
                    <table className="selected-data-table">
                      <tbody>
                        <tr><td>PM2.5 ({selectedPm25.units})</td><td><strong>{selectedPm25.value.toFixed(2)}</strong></td></tr>
                        <tr><td>LAT / LON</td><td className="coord-cell">{selectedPm25.lat.toFixed(5)}, {selectedPm25.lon.toFixed(5)}</td></tr>
                        <tr><td>DATE</td><td>{formatDateMonthDayYear(selectedPm25.date)}</td></tr>
                        <tr><td>RANGE (min–max)</td><td>{selectedPm25.min.toFixed(1)} – {selectedPm25.max.toFixed(1)} {selectedPm25.units}</td></tr>
                      </tbody>
                    </table>
                    <p className="data-source-footer">
                      {selectedPm25.source === 'sample' ? '⚠ Sample data · ' : 'Source: NASA GES DISC · '}
                      Click or hover on the PM2.5 layer for values
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
