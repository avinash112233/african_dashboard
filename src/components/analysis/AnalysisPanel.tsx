import { useCallback, useEffect, useMemo, useState } from 'react';
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
  AnalysisChartMode,
  AnalysisLocationContext,
  AnalysisVariableId,
  NormalizedSeries,
} from '../../analysis/types';
import UnifiedAnalysisChart from './UnifiedAnalysisChart';
import './AnalysisPanel.css';

type AnalysisRangeOption = '7D' | '30D' | '90D';

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
}: AnalysisPanelProps) => {
  const [chartMode, setChartMode] = useState<AnalysisChartMode>('timeseries');
  const [selectedVars, setSelectedVars] = useState<AnalysisVariableId[]>(DEFAULT_ANALYSIS_VARIABLES);
  const [seriesList, setSeriesList] = useState<NormalizedSeries[]>([]);
  const [loading, setLoading] = useState(false);
  const [resolvedLocation, setResolvedLocation] = useState<AnalysisLocationContext | null>(null);
  // true once Phase 2 (MERRA2 linking) finishes — whether found or timed out.
  const [merra2LinkDone, setMerra2LinkDone] = useState(false);
  const [scatterX, setScatterX] = useState<AnalysisVariableId>('aeronet_aod_500');
  const [scatterY, setScatterY] = useState<AnalysisVariableId>('merra2_pm25');

  // Phase 1: set location immediately so AERONET data loads right away.
  // Phase 2: resolve MERRA2 station in background (5-second timeout).
  useEffect(() => {
    let cancelled = false;
    setSeriesList([]);        // clear stale data from previous anchor
    setMerra2LinkDone(false); // reset linking status

    // Phase 1 — set location now (AERONET data will load immediately).
    const base: AnalysisLocationContext = { ...location };
    setResolvedLocation(base);

    // If MERRA2 already known (e.g. clicked a MERRA2 station), skip Phase 2.
    if (base.merra2Sitename != null && base.merra2LinkDistanceKm != null) {
      setMerra2LinkDone(true);
      return;
    }

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), 8000)
    );

    (async () => {
      try {
        // Use already-loaded stations from DashboardPage (instant, no backend call needed).
        // Fall back to backend API only if preloaded list is empty.
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
        // Timeout or backend unavailable — AERONET data already loaded in Phase 1.
      } finally {
        if (!cancelled) setMerra2LinkDone(true);
      }
    })();

    return () => { cancelled = true; };
  }, [location]);

  const loadSeries = useCallback(async (loc: AnalysisLocationContext) => {
    setLoading(true);
    try {
      const data = await fetchAnalysisSeries(
        selectedVars,
        loc,
        startDate,
        endDate,
        aeronetAodVersion
      );
      setSeriesList(data);
    } finally {
      setLoading(false);
    }
  }, [selectedVars, startDate, endDate, aeronetAodVersion]);

  // Fire whenever resolvedLocation changes (Phase 1 fires AERONET, Phase 2 adds MERRA2).
  useEffect(() => {
    if (!resolvedLocation) return;
    loadSeries(resolvedLocation);
  }, [resolvedLocation, loadSeries]); // eslint-disable-line react-hooks/exhaustive-deps

  const scatterIds = useMemo(() => {
    const withData = seriesList.filter((s) => s.points.length > 0);
    const x = withData.find((s) => s.variable === scatterX);
    const y = withData.find((s) => s.variable === scatterY);
    return {
      scatterXId: x?.id ?? withData[0]?.id,
      scatterYId: y?.id ?? withData[1]?.id ?? withData[0]?.id,
    };
  }, [seriesList, scatterX, scatterY]);

  const errors = seriesList
    .filter((s) => s.error)
    .map((s) => `${s.label}: ${s.error}`);

  const hasAnyData = seriesList.some((s) => s.points.length > 0);
  const allEmpty = seriesList.length > 0 && !hasAnyData && !loading;

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

  // Use the incoming location for display until resolution completes.
  const displayLocation = resolvedLocation ?? location;
  const merra2DistKm = displayLocation.merra2LinkDistanceKm;
  const merra2LinkText = displayLocation.merra2Sitename
    ? merra2DistKm != null && merra2DistKm > 0
      ? `${displayLocation.merra2Sitename} (${merra2DistKm.toFixed(0)} km)`
      : displayLocation.merra2Sitename
    : null;
  const merra2IsFar = displayLocation.merra2LinkBeyondPreferred === true;
  // "linking" only while Phase 2 is still in progress (not yet done, no sitename found yet).
  const isLinking = !merra2LinkDone && resolvedLocation?.merra2Sitename == null;

  return (
    <section className="analysis-panel" aria-label="Cross-layer analysis">
      <div className="analysis-panel-title-row">
        <h6>Analysis location</h6>
        {onClearAnchor && (
          <button type="button" className="analysis-clear-anchor" onClick={onClearAnchor}>
            Clear
          </button>
        )}
      </div>
      <p className="analysis-panel-location">
        <strong>{displayLocation.label}</strong>
        <br />
        <span className="analysis-meta-line">
          Source: {anchorSourceLabel(displayLocation.anchorSource)}
        </span>
        <br />
        <span className="analysis-meta-line">
          {displayLocation.latitude.toFixed(4)}°, {displayLocation.longitude.toFixed(4)}°
        </span>
        {displayLocation.aeronetQuerySite && (
          <>
            <br />
            <span className="analysis-meta-line">AERONET: {displayLocation.aeronetQuerySite}</span>
          </>
        )}
        <br />
        <span className={`analysis-meta-line${merra2IsFar ? ' analysis-meta-warning' : ''}`}>
          MERRA2:{' '}
          {isLinking
            ? 'searching…'
            : merra2LinkText
              ? <>
                  {merra2LinkText}
                  {merra2IsFar && (
                    <span className="analysis-far-badge" title={`Beyond preferred ${MERRA2_STATION_LINK_MAX_KM} km radius`}>
                      {' '}⚠ nearest available
                    </span>
                  )}
                </>
              : merra2LinkDone
                ? <span style={{ color: '#9ca3af' }}>unavailable (start backend)</span>
                : 'searching…'}
        </span>
        <br />
        <span className="analysis-meta-line">
          Range: {startDate} – {endDate}
        </span>
      </p>

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
        <div className="analysis-controls-row">
          <label htmlFor="analysis-chart-mode">Chart</label>
          <select
            id="analysis-chart-mode"
            value={chartMode}
            onChange={(e) => setChartMode(e.target.value as AnalysisChartMode)}
          >
            <option value="timeseries">Time series</option>
            <option value="scatter">Scatter (X vs Y)</option>
          </select>
        </div>

        <div className="analysis-variable-list">
          {ANALYSIS_VARIABLES.map((v) => (
            <label key={v.id} className={`analysis-var-label analysis-var-source-${v.source}`}>
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

        {chartMode === 'scatter' && (
          <div className="analysis-controls-row">
            <label htmlFor="scatter-x">X</label>
            <select
              id="scatter-x"
              value={scatterX}
              onChange={(e) => setScatterX(e.target.value as AnalysisVariableId)}
            >
              {selectedVars.map((id) => {
                const d = getVariableDef(id);
                return d ? (
                  <option key={id} value={id}>
                    {d.label}
                  </option>
                ) : null;
              })}
            </select>
            <label htmlFor="scatter-y">Y</label>
            <select
              id="scatter-y"
              value={scatterY}
              onChange={(e) => setScatterY(e.target.value as AnalysisVariableId)}
            >
              {selectedVars.map((id) => {
                const d = getVariableDef(id);
                return d ? (
                  <option key={id} value={id}>
                    {d.label}
                  </option>
                ) : null;
              })}
            </select>
          </div>
        )}
      </div>

      {loading && <p className="analysis-loading">Loading analysis data…</p>}

      <div className="analysis-chart-wrap">
        <UnifiedAnalysisChart
          seriesList={seriesList}
          mode={chartMode}
          scatterXId={scatterIds.scatterXId}
          scatterYId={scatterIds.scatterYId}
        />
      </div>

      {allEmpty && !isLinking && (
        <p className="analysis-empty">
          No data for the selected range and variables.
          {!displayLocation.aeronetQuerySite && ' Click an AERONET site to get AOD data.'}
          {!displayLocation.merra2Sitename && ' No MERRA2 station found nearby.'}
        </p>
      )}

      {errors.length > 0 && (
        <p className="analysis-errors">{errors.join(' · ')}</p>
      )}

      <div className="analysis-actions">
        <button type="button" className="primary" onClick={() => resolvedLocation && loadSeries(resolvedLocation)} disabled={loading}>
          Refresh
        </button>
        <button
          type="button"
          onClick={handleExport}
          disabled={seriesList.every((s) => s.points.length === 0)}
        >
          Download CSV
        </button>
      </div>
    </section>
  );
};

export default AnalysisPanel;
