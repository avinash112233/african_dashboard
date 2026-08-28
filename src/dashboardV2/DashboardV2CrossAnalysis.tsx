import { useEffect, useMemo, useState } from 'react';
import type { AERONETDataPoint } from '../services/aeronetApi';
import type { AERONETAODVersion } from '../services/aeronetApi';
import type { MERRA2StationDailyRecord, MERRA2StationTimeseriesPoint } from '../services/merra2Api';
import type { OpenAqStationRecord, OpenAqTimeseriesPoint } from '../services/openaqApi';
import type { AnalysisLocationContext, AnalysisVariableId, NormalizedSeries } from '../analysis/types';
import {
  aeronetPointsToSeries,
  merra2PointsToSeries,
  openAqPointsToSeries,
  washuPinPointsToSeries,
  washuStationPointsToSeries,
} from '../analysis/preloadedSeries';
import AnalysisPanel from '../components/analysis/AnalysisPanel';
import type { AnalysisWorkflow } from './config';
import {
  defaultPresetForAnchor,
  defaultPresetForWorkflow,
  presetsForWorkflow,
  type CrossAnalysisPresetId,
} from './analysisPresets';
import type { WashUTimeseriesPoint, WashUStationTimeseriesPoint } from '../services/washuApi';

interface DashboardV2CrossAnalysisProps {
  workflow: AnalysisWorkflow;
  anchor: AnalysisLocationContext | null;
  startDate: string;
  endDate: string;
  plotRangeLabel: string;
  aeronetAodVersion: AERONETAODVersion;
  merra2Stations: MERRA2StationDailyRecord[];
  openAqStations: OpenAqStationRecord[];
  openAqSeries: OpenAqTimeseriesPoint[];
  merra2Series: MERRA2StationTimeseriesPoint[];
  aeronetChartData: AERONETDataPoint[];
  washuPinSeries: WashUTimeseriesPoint[];
  washuStationSeries: WashUStationTimeseriesPoint[];
  onClearAnchor: () => void;
}

function buildPreloadedSeries(
  anchor: AnalysisLocationContext,
  openAqSeries: OpenAqTimeseriesPoint[],
  merra2Series: MERRA2StationTimeseriesPoint[],
  aeronetChartData: AERONETDataPoint[],
  washuPinSeries: WashUTimeseriesPoint[],
  washuStationSeries: WashUStationTimeseriesPoint[]
): Partial<Record<AnalysisVariableId, NormalizedSeries>> {
  const out: Partial<Record<AnalysisVariableId, NormalizedSeries>> = {};

  if (anchor.openaqSensorId != null && openAqSeries.length > 0) {
    const series = openAqPointsToSeries(openAqSeries);
    if (series) out.openaq_pm25 = series;
  }

  if (anchor.merra2Sitename && merra2Series.length > 0) {
    const series = merra2PointsToSeries(merra2Series);
    if (series) out.merra2_pm25 = series;
  }

  if (anchor.anchorSource === 'washu') {
    if (anchor.washuSitename && washuStationSeries.length > 0) {
      const series = washuStationPointsToSeries(washuStationSeries);
      if (series) out.washu_pm25 = series;
    } else if (washuPinSeries.length > 0) {
      const series = washuPinPointsToSeries(washuPinSeries);
      if (series) out.washu_pm25 = series;
    }
  }

  if (anchor.aeronetQuerySite && aeronetChartData.length > 0) {
    const series500 = aeronetPointsToSeries(aeronetChartData, 'aeronet_aod_500');
    if (series500) out.aeronet_aod_500 = series500;
    const series675 = aeronetPointsToSeries(aeronetChartData, 'aeronet_aod_675');
    if (series675) out.aeronet_aod_675 = series675;
  }

  return out;
}

const DashboardV2CrossAnalysis = ({
  workflow,
  anchor,
  startDate,
  endDate,
  plotRangeLabel,
  aeronetAodVersion,
  merra2Stations,
  openAqStations,
  openAqSeries,
  merra2Series,
  aeronetChartData,
  washuPinSeries,
  washuStationSeries,
  onClearAnchor,
}: DashboardV2CrossAnalysisProps) => {
  const availablePresets = useMemo(() => presetsForWorkflow(workflow), [workflow]);
  const [presetId, setPresetId] = useState<CrossAnalysisPresetId>(() =>
    defaultPresetForWorkflow(workflow)
  );

  useEffect(() => {
    setPresetId(defaultPresetForWorkflow(workflow));
  }, [workflow]);

  useEffect(() => {
    if (!anchor) return;
    setPresetId(defaultPresetForAnchor(anchor.anchorSource, workflow));
  }, [anchor?.latitude, anchor?.longitude, anchor?.anchorSource, workflow]);

  const activePreset = useMemo(
    () => availablePresets.find((p) => p.id === presetId) ?? availablePresets[0],
    [availablePresets, presetId]
  );

  const preloadedSeries = useMemo(
    () =>
      anchor
        ? buildPreloadedSeries(
            anchor,
            openAqSeries,
            merra2Series,
            aeronetChartData,
            washuPinSeries,
            washuStationSeries
          )
        : undefined,
    [anchor, openAqSeries, merra2Series, aeronetChartData, washuPinSeries, washuStationSeries]
  );

  if (!anchor) {
    return (
      <div className="plot-card charts-section dashboard-v2-cross-analysis dashboard-v2-cross-analysis--empty">
        <div className="charts-section-header">
          <h6>Cross-layer analysis</h6>
        </div>
        <p className="layer-tip dashboard-v2-chart-subtitle">
          Click a station, monitor, or map point to compare PM₂.₅, AOD, fires, and forecasts at one
          location. Date range follows the plotting panel ({plotRangeLabel}).
        </p>
      </div>
    );
  }

  if (!activePreset) {
    return null;
  }

  return (
    <div className="plot-card charts-section dashboard-v2-cross-analysis">
      <div className="charts-section-header dashboard-v2-cross-analysis-header">
        <div>
          <h6>Cross-layer analysis</h6>
          <p className="layer-tip dashboard-v2-chart-subtitle mb-0">
            {activePreset.description} · {plotRangeLabel} ({startDate} – {endDate})
          </p>
        </div>
      </div>

      <div className="dashboard-v2-cross-analysis-presets" role="tablist" aria-label="Analysis preset">
        {availablePresets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            role="tab"
            aria-selected={preset.id === activePreset.id}
            className={`dashboard-v2-cross-analysis-preset${
              preset.id === activePreset.id ? ' dashboard-v2-cross-analysis-preset--active' : ''
            }`}
            onClick={() => setPresetId(preset.id)}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <AnalysisPanel
        key={`${anchor.latitude}-${anchor.longitude}-${presetId}`}
        location={anchor}
        startDate={startDate}
        endDate={endDate}
        aeronetAodVersion={aeronetAodVersion}
        onClearAnchor={onClearAnchor}
        preloadedStations={merra2Stations}
        preloadedOpenAqStations={openAqStations}
        preloadedSeries={preloadedSeries}
        chartsLayout="inline"
        hideRangeControl
        hideVariableToggles
        presetVariables={activePreset.variables}
        presetScatterX={activePreset.scatterX}
        presetScatterY={activePreset.scatterY}
      />
    </div>
  );
};

export default DashboardV2CrossAnalysis;
