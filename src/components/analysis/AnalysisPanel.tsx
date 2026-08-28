import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { jsPDF } from 'jspdf';
import type { AERONETAODVersion } from '../../services/aeronetApi';
import { getMERRA2StationList } from '../../services/merra2Api';
import type { MERRA2StationDailyRecord } from '../../services/merra2Api';
import type { OpenAqStationRecord } from '../../services/openaqApi';
import {
  ANALYSIS_VARIABLES,
  DEFAULT_ANALYSIS_VARIABLES,
  getVariableDef,
} from '../../analysis/catalog';
import { fetchAnalysisSeries } from '../../analysis/fetchAnalysisSeries';
import { downloadCsv, seriesListToCsv } from '../../analysis/exportSeries';
import { MERRA2_STATION_LINK_MAX_KM, OPENAQ_LINK_PREFERRED_KM } from '../../analysis/constants';
import { anchorSourceLabel } from '../../analysis/locationAnchor';
import { resolveColocationLinks } from '../../analysis/resolveColocation';
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
  incoming: NormalizedSeries[],
  order: AnalysisVariableId[]
): NormalizedSeries[] {
  const byVar = new Map(prev.map((s) => [s.variable, s]));
  for (const series of incoming) byVar.set(series.variable, series);
  return order
    .map((vid) => byVar.get(vid) ?? emptySeriesFor(vid))
    .filter((s): s is NormalizedSeries => s != null);
}

function canFetchVariable(vid: AnalysisVariableId, loc: AnalysisLocationContext): boolean {
  const src = getVariableDef(vid)?.source;
  if (src === 'merra2') return Boolean(loc.merra2Sitename);
  if (src === 'openaq') return Boolean(loc.openaqSensorId);
  if (src === 'aeronet') return Boolean(loc.aeronetQuerySite);
  return true;
}

interface AnalysisPanelProps {
  location: AnalysisLocationContext;
  startDate: string;
  endDate: string;
  aeronetAodVersion: AERONETAODVersion;
  analysisRange?: AnalysisRangeOption;
  onAnalysisRangeChange?: (range: AnalysisRangeOption) => void;
  onClearAnchor?: () => void;
  /** Already-loaded MERRA2 stations from DashboardPage — avoids a backend round-trip. */
  preloadedStations?: MERRA2StationDailyRecord[];
  /** Already-loaded OpenAQ monitors for nearest-monitor linking. */
  preloadedOpenAqStations?: OpenAqStationRecord[];
  /** Dashboard 1 uses modal charts; Dashboard 2 keeps inline scrollable charts. */
  chartsLayout?: 'modal' | 'inline';
  /** Dashboard 2: plot range comes from sidebar plotting panel. */
  hideRangeControl?: boolean;
  /** Dashboard 2: preset drives variable selection. */
  hideVariableToggles?: boolean;
  presetVariables?: AnalysisVariableId[];
  presetScatterX?: AnalysisVariableId;
  presetScatterY?: AnalysisVariableId;
  /** Series already loaded by the plot stack — skip duplicate network requests. */
  preloadedSeries?: Partial<Record<AnalysisVariableId, NormalizedSeries>>;
}

const AnalysisPanel = ({
  location,
  startDate,
  endDate,
  aeronetAodVersion,
  analysisRange = '30D',
  onAnalysisRangeChange,
  onClearAnchor,
  preloadedStations,
  preloadedOpenAqStations,
  chartsLayout = 'modal',
  hideRangeControl = false,
  hideVariableToggles = false,
  presetVariables,
  presetScatterX,
  presetScatterY,
  preloadedSeries,
}: AnalysisPanelProps) => {
  const [selectedVars, setSelectedVars] = useState<AnalysisVariableId[]>(
    presetVariables ?? DEFAULT_ANALYSIS_VARIABLES
  );
  const [seriesList, setSeriesList] = useState<NormalizedSeries[]>([]);
  const [loading, setLoading] = useState(false);
  const [resolvedLocation, setResolvedLocation] = useState<AnalysisLocationContext>(() => location);
  const [colocationLinkDone, setColocationLinkDone] = useState(true);
  const [scatterX, setScatterX] = useState<AnalysisVariableId>(
    presetScatterX ?? 'aeronet_aod_500'
  );
  const [scatterY, setScatterY] = useState<AnalysisVariableId>(presetScatterY ?? 'merra2_pm25');
  const [showModal, setShowModal] = useState(false);
  const [makingPdf, setMakingPdf] = useState(false);
  const chartsBodyRef = useRef<HTMLDivElement>(null);
  const loadGenRef = useRef(0);

  useEffect(() => {
    if (!presetVariables) return;
    setSelectedVars(presetVariables);
    if (presetScatterX) setScatterX(presetScatterX);
    if (presetScatterY) setScatterY(presetScatterY);
  }, [presetVariables, presetScatterX, presetScatterY]);

  const syncColocation = useMemo(
    () => resolveColocationLinks(location, preloadedStations, preloadedOpenAqStations),
    [location, preloadedStations, preloadedOpenAqStations]
  );

  // Resolve nearest MERRA2/OpenAQ synchronously when station lists are already on the page.
  useEffect(() => {
    setResolvedLocation(syncColocation.location);
    if (!syncColocation.needsAsyncMerra2List) {
      setColocationLinkDone(true);
      return;
    }

    let cancelled = false;
    setColocationLinkDone(false);
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), 3_000)
    );

    (async () => {
      try {
        const stations = await Promise.race([getMERRA2StationList(), timeout]);
        if (cancelled) return;
        const linked = resolveColocationLinks(
          location,
          stations,
          preloadedOpenAqStations
        );
        setResolvedLocation(linked.location);
      } catch {
        if (!cancelled) setResolvedLocation(syncColocation.location);
      } finally {
        if (!cancelled) setColocationLinkDone(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [location, syncColocation, preloadedOpenAqStations]);

  const seedSeriesList = useCallback(
    (vars: AnalysisVariableId[]) =>
      vars
        .map((vid) => preloadedSeries?.[vid] ?? emptySeriesFor(vid))
        .filter((s): s is NormalizedSeries => s != null),
    [preloadedSeries]
  );

  const loadSeriesForLocation = useCallback(
    async (loc: AnalysisLocationContext, variableIds: AnalysisVariableId[]) => {
      const varsToFetch = variableIds.filter((vid) => {
        if (preloadedSeries?.[vid]?.points.length) return false;
        return canFetchVariable(vid, loc);
      });

      const initial = seedSeriesList(variableIds);
      setSeriesList(initial);

      if (varsToFetch.length === 0) {
        setLoading(false);
        return;
      }

      const gen = ++loadGenRef.current;
      setLoading(true);

      try {
        const fetched = await fetchAnalysisSeries(
          varsToFetch,
          loc,
          startDate,
          endDate,
          aeronetAodVersion
        );
        if (gen !== loadGenRef.current) return;
        setSeriesList((prev) => mergeSeriesList(prev, fetched, variableIds));
      } finally {
        if (gen === loadGenRef.current) setLoading(false);
      }
    },
    [aeronetAodVersion, endDate, preloadedSeries, seedSeriesList, startDate]
  );

  // Fetch all preset variables in one parallel batch once colocation is ready.
  useEffect(() => {
    if (!colocationLinkDone) return;
    let cancelled = false;

    (async () => {
      if (cancelled) return;
      await loadSeriesForLocation(resolvedLocation, selectedVars);
    })();

    return () => {
      cancelled = true;
      loadGenRef.current += 1;
    };
  }, [
    colocationLinkDone,
    resolvedLocation,
    selectedVars,
    startDate,
    endDate,
    aeronetAodVersion,
    preloadedSeries,
    loadSeriesForLocation,
  ]);

  const loadSeries = useCallback(
    async (loc: AnalysisLocationContext) => {
      await loadSeriesForLocation(loc, selectedVars);
    },
    [loadSeriesForLocation, selectedVars]
  );

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
  const openaqLinkText = displayLocation.openaqLocationName
    ? displayLocation.openaqLinkDistanceKm != null && displayLocation.openaqLinkDistanceKm > 0
      ? `${displayLocation.openaqLocationName} (${displayLocation.openaqLinkDistanceKm.toFixed(0)} km)`
      : displayLocation.openaqLocationName
    : null;
  const openaqIsFar = displayLocation.openaqLinkBeyondPreferred === true;
  const isLinking = !colocationLinkDone;

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
              {isLinking && displayLocation.merra2Sitename == null
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
                  : colocationLinkDone
                    ? <span className="analysis-meta-dim">unavailable</span>
                    : 'searching…'}
            </span>

            <span className="analysis-meta-key">OpenAQ</span>
            <span className={`analysis-meta-val${openaqIsFar ? ' analysis-meta-warning' : ''}`}>
              {isLinking && displayLocation.openaqSensorId == null
                ? <span className="analysis-linking-badge">searching…</span>
                : openaqLinkText
                  ? <>
                      {openaqLinkText}
                      {openaqIsFar && (
                        <span
                          className="analysis-far-badge"
                          title={`Beyond preferred ${OPENAQ_LINK_PREFERRED_KM} km radius`}
                        >
                          {' '}⚠ nearest
                        </span>
                      )}
                    </>
                  : colocationLinkDone
                    ? <span className="analysis-meta-dim">no monitor linked</span>
                    : 'searching…'}
            </span>

            <span className="analysis-meta-key">Range</span>
            <span className="analysis-meta-val">{startDate} – {endDate}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="analysis-controls">
          {!hideRangeControl && onAnalysisRangeChange && (
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
          )}

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

        {!hideVariableToggles && (
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
        )}

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
