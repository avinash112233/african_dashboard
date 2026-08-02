import AqiCategoryLegend from '../components/maps/AqiCategoryLegend';
import WashUPm25GridLegend from '../components/maps/WashUPm25GridLegend';
import type { WashUPM25Sample } from '../components/maps/WashUPM25HeatMapLayer';
import { getProductById, type AnalysisWorkflow } from './config';

export type DashboardV2HeatLegendKind = 'washu' | 'merra2' | 'aaqe' | 'generic';

interface DashboardV2MapLegendProps {
  workflow: AnalysisWorkflow;
  heatProductId: string;
  showWashuHeat: boolean;
  showMerra2Grid: boolean;
  showMerra2Stations: boolean;
  showAaqeHeat: boolean;
  activeProductLabel: string;
  activeProductUnit: string;
  washuPeriodLabel?: string;
  washuGridSource?: 'satpm' | 'sample' | null;
  washuSample?: WashUPM25Sample | null;
  merra2GridSource?: 'gesdisc' | 'sample' | null;
  merra2GridHour?: number;
}

export function resolveHeatLegendKind({
  workflow,
  heatProductId,
  showWashuHeat,
  showMerra2Grid,
  showMerra2Stations,
  showAaqeHeat,
}: Pick<
  DashboardV2MapLegendProps,
  'workflow' | 'heatProductId' | 'showWashuHeat' | 'showMerra2Grid' | 'showMerra2Stations' | 'showAaqeHeat'
>): DashboardV2HeatLegendKind {
  const heatLayer = getProductById(workflow, heatProductId)?.layer;
  const showMerra2 = showMerra2Grid || showMerra2Stations;
  if (heatLayer === 'washu' && showWashuHeat) return 'washu';
  if (heatLayer === 'merra2' && showMerra2) return 'merra2';
  if (heatLayer === 'aaqe' && showAaqeHeat) return 'aaqe';
  if (showWashuHeat) return 'washu';
  if (showMerra2) return 'merra2';
  if (showAaqeHeat) return 'aaqe';
  return 'generic';
}

const DashboardV2MapLegend = ({
  workflow,
  heatProductId,
  showWashuHeat,
  showMerra2Grid,
  showMerra2Stations,
  showAaqeHeat,
  activeProductLabel,
  activeProductUnit,
  washuPeriodLabel,
  washuGridSource,
  washuSample,
  merra2GridSource,
  merra2GridHour = 12,
}: DashboardV2MapLegendProps) => {
  const kind = resolveHeatLegendKind({
    workflow,
    heatProductId,
    showWashuHeat,
    showMerra2Grid,
    showMerra2Stations,
    showAaqeHeat,
  });

  if (kind === 'washu') {
    return (
      <div className="dashboard-v2-map-legend-inner">
        <WashUPm25GridLegend
          source={washuGridSource}
          periodLabel={washuPeriodLabel ?? washuSample?.periodLabel}
          sample={washuSample}
        />
        <div className="panel-resize-note">Moveable · resizable</div>
      </div>
    );
  }

  if (kind === 'merra2') {
    const metaParts = [
      showMerra2Grid && showMerra2Stations
        ? 'Stations · daily mean · Grid · selected UTC hour'
        : showMerra2Grid
          ? 'Grid · selected UTC hour'
          : 'Stations · daily mean',
      showMerra2Grid ? `${String(merra2GridHour).padStart(2, '0')} UTC` : null,
      merra2GridSource === 'gesdisc' ? 'GES DISC' : null,
    ].filter(Boolean);

    return (
      <div className="dashboard-v2-map-legend-inner dashboard-v2-map-legend-inner--aqi">
        <div className="drag-handle dashboard-v2-legend-drag" aria-hidden="true">
          <i className="bi bi-grip-horizontal" />
        </div>
        <AqiCategoryLegend
          title="MERRA2 PM2.5 AQI categories"
          meta={metaParts.join(' · ')}
          rangeMode="aqi"
          variant="floating"
          className="dashboard-v2-merra2-aqi-legend"
        />
      </div>
    );
  }

  if (kind === 'aaqe') {
    return (
      <div className="dashboard-v2-map-legend-inner dashboard-v2-map-legend-inner--aqi">
        <div className="drag-handle dashboard-v2-legend-drag" aria-hidden="true">
          <i className="bi bi-grip-horizontal" />
        </div>
        <AqiCategoryLegend
          rangeMode="aqi"
          variant="floating"
          className="dashboard-v2-forecast-aqi-legend"
        />
      </div>
    );
  }

  return (
    <>
      <div className="d-flex justify-content-between align-items-center drag-handle">
        <strong>
          <i className="bi bi-grip-vertical me-1" aria-hidden="true" />
          {activeProductLabel}
        </strong>
        <span className="section-chip">{activeProductUnit}</span>
      </div>
      <div className="legend-ramp" aria-hidden="true" />
      <div className="legend-labels">
        <span>Min</span>
        <span>Q1</span>
        <span>Mid</span>
        <span>Q3</span>
        <span>Max</span>
      </div>
      <div className="panel-resize-note">Moveable · resizable</div>
    </>
  );
};

export default DashboardV2MapLegend;
