import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AERONETAODVersion } from '../../services/aeronetApi';
import { getMERRA2StationList } from '../../services/merra2Api';
import {
  ANALYSIS_VARIABLES,
  DEFAULT_ANALYSIS_VARIABLES,
  getVariableDef,
} from '../../analysis/catalog';
import { fetchAnalysisSeries } from '../../analysis/fetchAnalysisSeries';
import { downloadCsv, seriesListToCsv } from '../../analysis/exportSeries';
import { findNearestStation } from '../../analysis/linkStations';
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
}

const AnalysisPanel = ({
  location,
  startDate,
  endDate,
  aeronetAodVersion,
  analysisRange,
  onAnalysisRangeChange,
}: AnalysisPanelProps) => {
  const [chartMode, setChartMode] = useState<AnalysisChartMode>('timeseries');
  const [selectedVars, setSelectedVars] = useState<AnalysisVariableId[]>(DEFAULT_ANALYSIS_VARIABLES);
  const [seriesList, setSeriesList] = useState<NormalizedSeries[]>([]);
  const [loading, setLoading] = useState(false);
  const [resolvedLocation, setResolvedLocation] = useState<AnalysisLocationContext>(location);
  const [scatterX, setScatterX] = useState<AnalysisVariableId>('aeronet_aod_500');
  const [scatterY, setScatterY] = useState<AnalysisVariableId>('merra2_pm25');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let next: AnalysisLocationContext = { ...location };
      if (!next.merra2Sitename) {
        try {
          const stations = await getMERRA2StationList();
          const nearest = findNearestStation(
            next.latitude,
            next.longitude,
            stations.map((s) => ({
              latitude: s.latitude,
              longitude: s.longitude,
              sitename: s.sitename,
            }))
          );
          if (nearest) next = { ...next, merra2Sitename: nearest.sitename };
        } catch {
          /* station list optional */
        }
      }
      if (!cancelled) setResolvedLocation(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [location]);

  const loadSeries = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAnalysisSeries(
        selectedVars,
        resolvedLocation,
        startDate,
        endDate,
        aeronetAodVersion
      );
      setSeriesList(data);
    } finally {
      setLoading(false);
    }
  }, [selectedVars, resolvedLocation, startDate, endDate, aeronetAodVersion]);

  useEffect(() => {
    loadSeries();
  }, [loadSeries]);

  const scatterIds = useMemo(() => {
    const withData = seriesList.filter((s) => s.points.length > 0);
    const x = withData.find((s) => s.variable === scatterX);
    const y = withData.find((s) => s.variable === scatterY);
    return {
      scatterXId: x?.id ?? withData[0]?.id,
      scatterYId: y?.id ?? withData[1]?.id ?? withData[0]?.id,
    };
  }, [seriesList, scatterX, scatterY]);

  const errors = seriesList.filter((s) => s.error).map((s) => `${s.label}: ${s.error}`);

  const toggleVar = (id: AnalysisVariableId) => {
    setSelectedVars((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]
    );
  };

  const handleExport = () => {
    const ok = seriesList.filter((s) => s.points.length > 0);
    if (ok.length === 0) return;
    const safeName = resolvedLocation.label.replace(/[^\w.-]+/g, '_').slice(0, 40);
    downloadCsv(`analysis_${safeName}_${startDate}_${endDate}.csv`, seriesListToCsv(ok));
  };

  return (
    <section className="analysis-panel" aria-label="Cross-layer analysis">
      <h6>Analysis</h6>
      <p className="analysis-panel-location">
        <strong>{resolvedLocation.label}</strong>
        {resolvedLocation.merra2Sitename && (
          <> · MERRA2: {resolvedLocation.merra2Sitename}</>
        )}
        <br />
        {startDate} – {endDate}
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
            <label key={v.id}>
              <input
                type="checkbox"
                checked={selectedVars.includes(v.id)}
                onChange={() => toggleVar(v.id)}
              />
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

      {errors.length > 0 && (
        <p className="analysis-errors">{errors.join(' · ')}</p>
      )}

      <div className="analysis-actions">
        <button type="button" className="primary" onClick={loadSeries} disabled={loading}>
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
