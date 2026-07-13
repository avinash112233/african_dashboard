import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { jsPDF } from 'jspdf';
import type { AERONETAODVersion } from '../../services/aeronetApi';
import { getMERRA2StationList } from '../../services/merra2Api';
import type { MERRA2StationDailyRecord } from '../../services/merra2Api';
import {
  ANALYSIS_VARIABLES,
  DEFAULT_ANALYSIS_VARIABLES,
  getVariableDef,
} from '../../analysis/catalog';
import { fetchAnalysisSeries } from '../../analysis/fetchAnalysisSeries';
import { downloadCsv, seriesListToCsv } from '../../analysis/exportSeries';
import { MERRA2_STATION_LINK_MAX_KM } from '../../analysis/constants';
import { anchorSourceLabel } from '../../analysis/locationAnchor';
import { findNearestStationWithDistance } from '../../analysis/linkStations';
import type {
  AnalysisLocationContext,
  AnalysisVariableId,
  NormalizedSeries,
} from '../../analysis/types';
import AnalysisChartsBody from './AnalysisChartsBody';
import AnalysisChartsModal from './AnalysisChartsModal';
import { canvasWithValueLabels, renderCombinedForPdf } from './analysisChartsPdf';
import './AnalysisPanel.css';

type AnalysisRangeOption = '7D' | '30D' | '90D';

function emptySeriesFor(vid: AnalysisVariableId): NormalizedSeries | null {
  const def = getVariableDef(vid);
  if (!def) return null;
  return {
    id: `pending-${vid}`,
    source: def.source as NormalizedSeries['source'],
    variable: vid,
    label: def.label,
    unit: def.unit,
    points: [],
  };
}

function mergeSeriesList(
  prev: NormalizedSeries[],
  incoming: NormalizedSeries,
  order: AnalysisVariableId[]
): NormalizedSeries[] {
  const byVar = new Map(prev.map((s) => [s.variable, s]));
  byVar.set(incoming.variable, incoming);
  return order
    .map((vid) => byVar.get(vid) ?? emptySeriesFor(vid))
    .filter((s): s is NormalizedSeries => s != null);
}

interface AnalysisPanelProps {
  location: AnalysisLocationContext;
  startDate: string;
  endDate: string;
  aeronetAodVersion: AERONETAODVersion;
  analysisRange: AnalysisRangeOption;
  onAnalysisRangeChange: (range: AnalysisRangeOption) => void;
  onClearAnchor?: () => void;
  /** Already-loaded MERRA2 stations from DashboardPage — avoids a backend round-trip. */
  preloadedStations?: MERRA2StationDailyRecord[];
  /** Dashboard 1 uses modal charts; Dashboard 2 keeps inline scrollable charts. */
  chartsLayout?: 'modal' | 'inline';
}

const AnalysisPanel = ({
  location,
  startDate,
  endDate,
  aeronetAodVersion,
  analysisRange,
  onAnalysisRangeChange,
  onClearAnchor,
  preloadedStations,
  chartsLayout = 'modal',
}: AnalysisPanelProps) => {
  const [selectedVars, setSelectedVars] = useState<AnalysisVariableId[]>(DEFAULT_ANALYSIS_VARIABLES);
  const [seriesList, setSeriesList] = useState<NormalizedSeries[]>([]);
  const [loading, setLoading] = useState(false);
  const [resolvedLocation, setResolvedLocation] = useState<AnalysisLocationContext | null>(null);
  const [merra2LinkDone, setMerra2LinkDone] = useState(false);
  const [scatterX, setScatterX] = useState<AnalysisVariableId>('aeronet_aod_500');
  const [scatterY, setScatterY] = useState<AnalysisVariableId>('merra2_pm25');
  const [showModal, setShowModal] = useState(false);
  const [makingPdf, setMakingPdf] = useState(false);
  const chartsBodyRef = useRef<HTMLDivElement>(null);
  const loadGenRef = useRef(0);
  const inflightLoadsRef = useRef(0);

  // Phase 1: set location immediately. Phase 2: resolve nearest MERRA2 station in background.
  useEffect(() => {
    let cancelled = false;
    setMerra2LinkDone(false);

    const base: AnalysisLocationContext = { ...location };
    setResolvedLocation(base);
    setSeriesList(
      selectedVars.map((vid) => emptySeriesFor(vid)).filter((s): s is NormalizedSeries => s != null)
    );

    if (base.merra2Sitename != null && base.merra2LinkDistanceKm != null) {
      setMerra2LinkDone(true);
      return;
    }

    const linkTimeoutMs = preloadedStations && preloadedStations.length > 0 ? 2_000 : 5_000;
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), linkTimeoutMs)
    );

    (async () => {
      try {
        const stations = (preloadedStations && preloadedStations.length > 0)
          ? preloadedStations
          : await Promise.race([getMERRA2StationList(), timeout]);
        const nearest = findNearestStationWithDistance(
          base.latitude,
          base.longitude,
          stations.map((s) => ({
            latitude: s.latitude,
            longitude: s.longitude,
            sitename: s.sitename,
          }))
        );
        if (!cancelled && nearest) {
          setResolvedLocation({
            ...base,
            merra2Sitename: nearest.station.sitename,
            merra2LinkDistanceKm: nearest.distanceKm,
            merra2LinkBeyondPreferred: nearest.isBeyondPreferred,
          });
        }
      } catch {
        // Timeout or backend unavailable — non-MERRA2 series still load below.
      } finally {
        if (!cancelled) setMerra2LinkDone(true);
      }
    })();

    return () => { cancelled = true; };
  }, [location, preloadedStations]);

  const loadVariables = useCallback(async (
    loc: AnalysisLocationContext,
    variableIds: AnalysisVariableId[]
  ) => {
    if (variableIds.length === 0) return;
    const gen = ++loadGenRef.current;
    inflightLoadsRef.current += 1;
    setLoading(true);

    try {
      await Promise.all(
        variableIds.map(async (vid) => {
          const [series] = await fetchAnalysisSeries(
            [vid],
            loc,
            startDate,
            endDate,
            aeronetAodVersion
          );
          if (!series || gen !== loadGenRef.current) return;
          setSeriesList((prev) => mergeSeriesList(prev, series, selectedVars));
        })
      );
    } finally {
      inflightLoadsRef.current -= 1;
      if (inflightLoadsRef.current <= 0 && gen === loadGenRef.current) {
        inflightLoadsRef.current = 0;
        setLoading(false);
      }
    }
  }, [selectedVars, startDate, endDate, aeronetAodVersion]);

  // Load AERONET / AAQE / FIRMS immediately — do not wait for MERRA2 link.
  useEffect(() => {
    if (!resolvedLocation) return;
    const vars = selectedVars.filter((vid) => getVariableDef(vid)?.source !== 'merra2');
    loadVariables(resolvedLocation, vars);
  }, [
    resolvedLocation?.latitude,
    resolvedLocation?.longitude,
    resolvedLocation?.aeronetQuerySite,
    resolvedLocation?.anchorSource,
    selectedVars,
    startDate,
    endDate,
    aeronetAodVersion,
    loadVariables,
  ]);

  // Load MERRA2 variables only after nearest station is resolved (avoids a full reload).
  useEffect(() => {
    if (!resolvedLocation?.merra2Sitename) return;
    const vars = selectedVars.filter((vid) => getVariableDef(vid)?.source === 'merra2');
    loadVariables(resolvedLocation, vars);
  }, [
    resolvedLocation?.merra2Sitename,
    selectedVars,
    startDate,
    endDate,
    aeronetAodVersion,
    loadVariables,
  ]);

  const loadSeries = useCallback(async (loc: AnalysisLocationContext) => {
    setSeriesList(
      selectedVars.map((vid) => emptySeriesFor(vid)).filter((s): s is NormalizedSeries => s != null)
    );
    const vars = selectedVars.filter((vid) => {
      const src = getVariableDef(vid)?.source;
      return src !== 'merra2' || Boolean(loc.merra2Sitename);
    });
    await loadVariables(loc, vars);
  }, [selectedVars, loadVariables]);

  const seriesWithData = useMemo(
    () => seriesList.filter((s) => s.points.length > 0),
    [seriesList]
  );

  const errors = seriesList.filter((s) => s.error).map((s) => `${s.label}: ${s.error}`);

  const toggleVar = (id: AnalysisVariableId) => {
    setSelectedVars((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]
    );
  };

  const handleExport = () => {
    const ok = seriesList.filter((s) => s.points.length > 0);
    if (ok.length === 0) return;
    const safeName = (resolvedLocation ?? location).label.replace(/[^\w.-]+/g, '_').slice(0, 40);
    downloadCsv(`analysis_${safeName}_${startDate}_${endDate}.csv`, seriesListToCsv(ok));
  };

  const handleDownloadPdf = async () => {
    if (!chartsBodyRef.current) return;
    setMakingPdf(true);
    try {
      const active    = seriesList.filter((s) => s.points.length > 0);
      const loc       = resolvedLocation ?? location;
      const pdf       = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const PW        = 297;
      const PH        = 210;
      const M         = 12;
      const HDR_H     = 22;
      const safeLoc   = loc.label.replace(/[^\w.-]+/g, '_').slice(0, 30);
      const subtitle  = `${loc.label}  ·  ${anchorSourceLabel(loc.anchorSource)}  ·  ${startDate} – ${endDate}`;

      const addHeader = (label: string) => {
        pdf.setFontSize(9);
        pdf.setTextColor(107, 114, 128);
        pdf.text(subtitle, M, M - 1);
        pdf.setFontSize(15);
        pdf.setTextColor(17, 24, 39);
        pdf.text(label, M, M + 8);
        pdf.setDrawColor(209, 213, 219);
        pdf.setLineWidth(0.4);
        pdf.line(M, M + 11, PW - M, M + 11);
      };

      const addCanvas = (canvas: HTMLCanvasElement) => {
        const availW  = (PW - M * 2) * 0.88;
        const availH  = (PH - M - HDR_H - M) * 0.88;
        const aspect  = canvas.width / canvas.height;
        let iw = availW;
        let ih = iw / aspect;
        if (ih > availH) { ih = availH; iw = ih * aspect; }
        const fullW = PW - M * 2;
        const fullH = PH - M - HDR_H - M;
        const ix = M + (fullW - iw) / 2;
        const iy = M + HDR_H + (fullH - ih) / 2;
        pdf.addImage(canvas.toDataURL('image/png', 1.0), 'PNG', ix, iy, iw, ih);
      };

      let firstPage = true;

      const cards = Array.from(
        chartsBodyRef.current.querySelectorAll<HTMLDivElement>('[data-chart-label]')
      );

      for (const card of cards) {
        const src = card.querySelector<HTMLCanvasElement>('canvas');
        if (!src) continue;

        const label = card.getAttribute('data-chart-label') ?? 'Chart';
        if (!firstPage) pdf.addPage('a4', 'landscape');
        firstPage = false;

        addHeader(label);
        addCanvas(canvasWithValueLabels(src));
      }

      if (active.length >= 2) {
        if (!firstPage) pdf.addPage('a4', 'landscape');
        firstPage = false;
        addHeader('Combined Comparison — All Series');
        const combined = await renderCombinedForPdf(active);
        addCanvas(combined);
      }

      if (firstPage) {
        pdf.setFontSize(11);
        pdf.setTextColor(156, 163, 175);
        pdf.text('No chart data available for the selected variables and date range.', M, PH / 2);
      }

      pdf.save(`analysis_${safeLoc}_${startDate}_${endDate}.pdf`);
    } finally {
      setMakingPdf(false);
    }
  };

  const displayLocation   = resolvedLocation ?? location;
  const merra2DistKm      = displayLocation.merra2LinkDistanceKm;
  const merra2LinkText    = displayLocation.merra2Sitename
    ? merra2DistKm != null && merra2DistKm > 0
      ? `${displayLocation.merra2Sitename} (${merra2DistKm.toFixed(0)} km)`
      : displayLocation.merra2Sitename
    : null;
  const merra2IsFar    = displayLocation.merra2LinkBeyondPreferred === true;
  const isLinking      = !merra2LinkDone && resolvedLocation?.merra2Sitename == null;

  return (
    <>
      <section className="analysis-panel" aria-label="Cross-layer analysis">
        {/* Title row */}
        <div className="analysis-panel-title-row">
          <h6>Analysis location</h6>
          {onClearAnchor && (
            <button type="button" className="analysis-clear-anchor" onClick={onClearAnchor}>
              Clear
            </button>
          )}
        </div>

        {/* Location metadata */}
        <div className="analysis-location-card">
          <p className="analysis-location-name">{displayLocation.label}</p>
          <div className="analysis-meta-grid">
            <span className="analysis-meta-key">Source</span>
            <span className="analysis-meta-val">{anchorSourceLabel(displayLocation.anchorSource)}</span>

            <span className="analysis-meta-key">Coords</span>
            <span className="analysis-meta-val">
              {displayLocation.latitude.toFixed(4)}°, {displayLocation.longitude.toFixed(4)}°
            </span>

            {displayLocation.aeronetQuerySite && (
              <>
                <span className="analysis-meta-key">AERONET</span>
                <span className="analysis-meta-val">{displayLocation.aeronetQuerySite}</span>
              </>
            )}

            <span className="analysis-meta-key">MERRA2</span>
            <span className={`analysis-meta-val${merra2IsFar ? ' analysis-meta-warning' : ''}`}>
              {isLinking
                ? <span className="analysis-linking-badge">searching…</span>
                : merra2LinkText
                  ? <>
                      {merra2LinkText}
                      {merra2IsFar && (
                        <span
                          className="analysis-far-badge"
                          title={`Beyond preferred ${MERRA2_STATION_LINK_MAX_KM} km radius`}
                        >
                          {' '}⚠ nearest
                        </span>
                      )}
                    </>
                  : merra2LinkDone
                    ? <span className="analysis-meta-dim">unavailable (start backend)</span>
                    : 'searching…'}
            </span>

            <span className="analysis-meta-key">Range</span>
            <span className="analysis-meta-val">{startDate} – {endDate}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="analysis-controls">
          <div className="analysis-controls-row">
            <label htmlFor="analysis-range">Range</label>
            <select
              id="analysis-range"
              value={analysisRange}
              onChange={(e) => onAnalysisRangeChange(e.target.value as AnalysisRangeOption)}
            >
              <option value="7D">Last 7 days</option>
              <option value="30D">Last 30 days</option>
              <option value="90D">Last 90 days</option>
            </select>
          </div>

          {/* Scatter axis pickers — compact, always visible */}
          <div className="analysis-scatter-row">
            <span className="analysis-scatter-label">Scatter</span>
            <select
              value={scatterX}
              onChange={(e) => setScatterX(e.target.value as AnalysisVariableId)}
            >
              {selectedVars.map((id) => {
                const d = getVariableDef(id);
                return d ? <option key={id} value={id}>{d.label}</option> : null;
              })}
            </select>
            <span className="analysis-scatter-vs">vs</span>
            <select
              value={scatterY}
              onChange={(e) => setScatterY(e.target.value as AnalysisVariableId)}
            >
              {selectedVars.map((id) => {
                const d = getVariableDef(id);
                return d ? <option key={id} value={id}>{d.label}</option> : null;
              })}
            </select>
          </div>
        </div>

        {/* Variable checkboxes */}
        <div className="analysis-variable-list">
          {ANALYSIS_VARIABLES.map((v) => (
            <label key={v.id} className="analysis-var-label">
              <input
                type="checkbox"
                checked={selectedVars.includes(v.id)}
                onChange={() => toggleVar(v.id)}
              />
              <span className={`analysis-var-dot analysis-var-dot-${v.source}`} />
              {v.label}
            </label>
          ))}
        </div>

        {/* Status row */}
        {loading && (
          <div className="analysis-status-row">
            <span className="analysis-spinner" />
            <span className="analysis-loading-text">Loading…</span>
          </div>
        )}
        {errors.length > 0 && (
          <p className="analysis-errors">{errors.join(' · ')}</p>
        )}

        {chartsLayout === 'modal' ? (
          <button
            type="button"
            className="analysis-open-charts-btn"
            onClick={() => setShowModal(true)}
            disabled={loading}
          >
            {loading
              ? 'Loading data…'
              : seriesWithData.length > 0
                ? `Open Charts  (${seriesWithData.length} series)`
                : 'Open Charts'}
          </button>
        ) : null}

        <div className="analysis-actions">
          <button
            type="button"
            onClick={() => resolvedLocation && loadSeries(resolvedLocation)}
            disabled={loading}
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          {chartsLayout === 'inline' && (
            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={makingPdf || loading || seriesWithData.length === 0}
              title="Download all charts as a PDF — includes value labels and a combined comparison chart"
            >
              {makingPdf ? 'Building PDF…' : 'Download PDF'}
            </button>
          )}
          <button
            type="button"
            onClick={handleExport}
            disabled={seriesList.every((s) => s.points.length === 0)}
          >
            Download CSV
          </button>
        </div>
      </section>

      {chartsLayout === 'inline' ? (
        <div className="analysis-charts-inline" ref={chartsBodyRef}>
          <AnalysisChartsBody
            seriesList={seriesList}
            loading={loading}
            scatterX={scatterX}
            scatterY={scatterY}
          />
        </div>
      ) : null}

      {chartsLayout === 'modal' && showModal && (
        <AnalysisChartsModal
          seriesList={seriesList}
          location={displayLocation}
          startDate={startDate}
          endDate={endDate}
          loading={loading}
          scatterX={scatterX}
          scatterY={scatterY}
          onClose={() => setShowModal(false)}
          onRefresh={() => resolvedLocation && loadSeries(resolvedLocation)}
          onExport={handleExport}
        />
      )}
    </>
  );
};

export default AnalysisPanel;
