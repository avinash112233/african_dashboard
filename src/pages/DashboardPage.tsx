import { useState, useEffect } from 'react';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import dayjs from 'dayjs';
import MapVisualization from '../components/maps/MapVisualization';
import { getNOAA21VIIRS7DayFromWFS } from '../services/firmsApi';
import { getAfricanAERONETSites, getAERONETData, getAERONETDataAfrica, type AERONETDataPoint, type SiteAODMap } from '../services/aeronetApi';
import type { FIRMSFirePoint } from '../services/firmsApi';
import type { AERONETSite } from '../services/aeronetApi';
import { TimeSeriesChart, ScatterPlotChart, WavelengthBarChart } from '../components/charts';
import { normalizeAeronetDate, formatDisplayDate, formatDateMonthDayYear } from '../utils/dateFormat';
import { computeDailyMeanAOD, getAODLevelColor, getAODLevelLabel, AOD_CLASSIFICATION_LEGEND } from '../utils/aodUtils';
import { haversineKm } from '../utils/geoUtils';
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
  const [showAeronet, setShowAeronet] = useState(true);
  const [showFires, setShowFires] = useState(false);
  const [showAODHeatMap, setShowAODHeatMap] = useState(false);
  const [showVIIRSImagery, setShowVIIRSImagery] = useState(false);
  const [circleSelectActive, setCircleSelectActive] = useState(false);
  const [circleCenter, setCircleCenter] = useState<[number, number] | null>(null);
  const [circleRadiusKm, setCircleRadiusKm] = useState(25);
  const [fireLoading, setFireLoading] = useState(false);
  const [aeronetLoading, setAeronetLoading] = useState(false);
  const [aeronetError, setAeronetError] = useState<string | null>(null);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [selectedSite, setSelectedSite] = useState<AERONETSite | null>(null);
  const [chartData, setChartData] = useState<AERONETDataPoint[]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [siteAodMap, setSiteAodMap] = useState<SiteAODMap>({});

  useEffect(() => {
    setFireLoading(true);
    getNOAA21VIIRS7DayFromWFS()
      .then(setFirePoints)
      .finally(() => setFireLoading(false));
  }, [selectedDate]);

  useEffect(() => {
    if (selectedSite) {
      const querySite = selectedSite.name && selectedSite.name !== selectedSite.site ? selectedSite.name : selectedSite.site;
      if (!querySite || typeof querySite !== 'string') return;
      setChartLoading(true);
      const start = selectedDate.subtract(6, 'day').format('YYYY-MM-DD');
      const end = selectedDate.format('YYYY-MM-DD');
      getAERONETData(querySite, start, end)
        .then((data) => setChartData(Array.isArray(data) ? data : []))
        .catch(() => setChartData([]))
        .finally(() => setChartLoading(false));
    }
  }, [selectedDate, selectedSite?.site, selectedSite?.name]);

  useEffect(() => {
    if (showAeronet || showAODHeatMap) {
      const start = selectedDate.subtract(6, 'day').format('YYYY-MM-DD');
      const end = selectedDate.format('YYYY-MM-DD');
      getAERONETDataAfrica(start, end).then(setSiteAodMap);
    }
  }, [selectedDate, showAeronet, showAODHeatMap]);

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

  const pointsInCircle = circleCenter
    ? firePoints.filter((p) => {
        if (isNaN(p.latitude) || isNaN(p.longitude)) return false;
        return haversineKm(circleCenter[0], circleCenter[1], p.latitude, p.longitude) <= circleRadiusKm;
      })
    : [];

  const handleAeronetSiteClick = (site: AERONETSite) => {
    setSelectedSite(site);
    setSelectedFire(null);
    setChartData([]);
  };

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
    a.download = `AERONET_${selectedSite.site}_${selectedDate.format('YYYY-MM-DD')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFireClick = (fire: FIRMSFirePoint) => {
    setSelectedSite(null);
    setChartData([]);
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
  };

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
                  checked={showAeronet}
                  onChange={(e) => setShowAeronet(e.target.checked)}
                  disabled={aeronetLoading}
                />
                AERONET Sites {aeronetLoading && '(loading...)'}
              </label>
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
                  checked={showFires}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setShowFires(checked);
                    if (checked) setShowAODHeatMap(false);
                    if (!checked) setCircleSelectActive(false);
                  }}
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
                      onChange={(e) => setCircleSelectActive(e.target.checked)}
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
                        <button
                          type="button"
                          onClick={() => {
                            setCircleCenter(null);
                            setCircleSelectActive(false);
                          }}
                          style={{ padding: '2px 8px', fontSize: 11 }}
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
              <small className="layer-tip">VIIRS NOAA-21 7d · Select area for points table (no zoom needed)</small>
              <label className="layer-checkbox">
                <input
                  type="checkbox"
                  checked={showAODHeatMap}
                  onChange={(e) => setShowAODHeatMap(e.target.checked)}
                />
                AOD Heat Map
              </label>
              {showAODHeatMap && (
                <small className="layer-tip">Green→Yellow→Orange→Red by AOD (AERONET 7d)</small>
              )}
              <label className="layer-checkbox">
                <input
                  type="checkbox"
                  checked={showVIIRSImagery}
                  onChange={(e) => setShowVIIRSImagery(e.target.checked)}
                />
                VIIRS Imagery
              </label>
              {showVIIRSImagery && (
                <small className="layer-tip">NASA GIBS · True Color (S-NPP) · Uses selected date</small>
              )}
              <label className="layer-checkbox layer-disabled">
                <input type="checkbox" disabled />
                MERRA2 PM2.5 (Coming soon)
              </label>
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
              <div className="map-loading-overlay">
                <div className="spinner-border text-primary" role="status" aria-hidden="true" />
                <p className="map-loading-text">Loading fire hotspots…</p>
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
                showAODHeatMap={showAODHeatMap}
                showVIIRSImagery={showVIIRSImagery}
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
                pointsInCircle={pointsInCircle}
              />
            </div>
            {showAeronet && (selectedSite ? (chartLoading || chartData.length > 0) : true) && (
              <div className="charts-section">
                <h6>Time Series Analysis</h6>
                {!selectedSite ? (
                  <p className="chart-placeholder">Click an AERONET site on the map or select one from the dropdown to view time series.</p>
                ) : chartLoading ? (
                  <div className="chart-loading-box">
                    <div className="chart-loading-spinner" />
                    <p className="chart-loading">Loading AOD data for {selectedSite.name ?? selectedSite.site}…</p>
                    <p className="chart-loading-hint">Updating charts and selected data panel</p>
                  </div>
                ) : (
                  <div className="charts-row" key={selectedSite?.site ?? 'charts'}>
                    <div className="chart-box">
                      <p className="chart-subtitle">AOD Time Series</p>
                      <div className="chart-container" key={`ts-${selectedSite?.site ?? ''}`}>
                        <TimeSeriesChart data={computeDailyMeanAOD(chartData)} selectedDate={selectedDate} />
                      </div>
                    </div>
                    <div className="chart-box">
                      <p className="chart-subtitle">AOD 500nm vs 675nm</p>
                      <div className="chart-container" key={`scatter-${selectedSite?.site ?? ''}`}>
                        <ScatterPlotChart data={computeDailyMeanAOD(chartData)} />
                      </div>
                    </div>
                    <div className="chart-box">
                      <p className="chart-subtitle">Wavelength Comparison</p>
                      <div className="chart-container" key={`wavelength-${selectedSite?.site ?? ''}`}>
                        <WavelengthBarChart data={computeDailyMeanAOD(chartData)} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </main>

          {/* Right sidebar - Selected Data */}
          {!rightPanelOpen && (
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
                        <tr><td>SELECTED DATE</td><td>{formatDateMonthDayYear(selectedDate.format('YYYY-MM-DD'))}</td></tr>
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
