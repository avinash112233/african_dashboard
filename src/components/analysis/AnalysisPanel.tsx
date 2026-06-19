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
  AnalysisLocationContext,
  AnalysisVariableId,
  NormalizedSeries,
} from '../../analysis/types';
import AnalysisChartsModal from './AnalysisChartsModal';
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
  const [selectedVars, setSelectedVars] = useState<AnalysisVariableId[]>(DEFAULT_ANALYSIS_VARIABLES);
  const [seriesList, setSeriesList] = useState<NormalizedSeries[]>([]);
  const [loading, setLoading] = useState(false);
  const [resolvedLocation, setResolvedLocation] = useState<AnalysisLocationContext | null>(null);
  const [merra2LinkDone, setMerra2LinkDone] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [scatterX, setScatterX] = useState<AnalysisVariableId>('aeronet_aod_500');
  const [scatterY, setScatterY] = useState<AnalysisVariableId>('merra2_pm25');

  // Phase 1: set location immediately so AERONET data loads right away.
  // Phase 2: resolve MERRA2 station in background (8-second timeout).
  useEffect(() => {
    let cancelled = false;
    setSeriesList([]);
    setMerra2LinkDone(false);

    const base: AnalysisLocationContext = { ...location };
    setResolvedLocation(base);

    if (base.merra2Sitename != null && base.merra2LinkDistanceKm != null) {
      setMerra2LinkDone(true);
      return;
    }

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), 8000)
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

  useEffect(() => {
    if (!resolvedLocation) return;
    loadSeries(resolvedLocation);
  }, [resolvedLocation, loadSeries]); // eslint-disable-line react-hooks/exhaustive-deps

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

        {/* Open Charts button — primary CTA */}
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

        {/* Secondary actions */}
        <div className="analysis-actions">
          <button
            type="button"
            onClick={() => resolvedLocation && loadSeries(resolvedLocation)}
            disabled={loading}
          >
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

      {/* Full-screen charts modal */}
      {showModal && (
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
