import { lazy, Suspense } from 'react';
import dayjs from 'dayjs';
import ChartLoadingFallback from '../components/charts/ChartLoadingFallback';
import type { useDashboardV2LayerFeatures } from './useDashboardV2LayerFeatures';
import { formatDisplayDate } from '../utils/dateFormat';
import type { useDashboardV2Data } from './useDashboardV2Data';
import { AeronetSelectedPanel } from './SelectedDataPanels';

const TimeSeriesChart = lazy(() => import('../components/charts/TimeSeriesChart'));
const ScatterPlotChart = lazy(() => import('../components/charts/ScatterPlotChart'));
const WavelengthBarChart = lazy(() => import('../components/charts/WavelengthBarChart'));

type LayerFeatures = ReturnType<typeof useDashboardV2LayerFeatures>;
type DashboardData = ReturnType<typeof useDashboardV2Data>;

interface DashboardV2AeronetTimeSeriesProps {
  data: DashboardData;
  layers: LayerFeatures;
}

const DashboardV2AeronetTimeSeries = ({ layers }: DashboardV2AeronetTimeSeriesProps) => {
  const site = layers.selectedSite;
  if (!site) return null;

  const siteLabel = site.name ?? site.site;

  return (
    <div className="plot-card charts-section dashboard-v2-aeronet-timeseries">
      <AeronetSelectedPanel
        site={site}
        chartData={layers.chartData}
        chartLoading={layers.chartLoading}
        chartError={layers.chartError}
        chartFromCache={layers.chartFromCache}
        aeronetStart={layers.analysisStartDate}
        aeronetEnd={layers.analysisEndDate}
      />

      <div className="charts-section-header dashboard-v2-timeseries-header">
        <h6>Time Series Analysis</h6>
        <div className="dashboard-v2-timeseries-controls">
          <button
            type="button"
            className="btn btn-outline-aaqe dashboard-v2-timeseries-export-btn"
            onClick={layers.exportAODCSV}
            disabled={layers.chartLoading || layers.chartData.length === 0}
          >
            <i className="bi bi-filetype-csv me-1" aria-hidden="true" />
            Export CSV
          </button>
          <button
            type="button"
            className="dashboard-v2-panel-close-btn"
            onClick={layers.dismissAeronetSelection}
            aria-label="Close time series analysis"
          >
            ×
          </button>
        </div>
      </div>

      <small className="layer-tip dashboard-v2-chart-subtitle">
        Showing: {layers.analysisRangeLabel} ({formatDisplayDate(layers.analysisStartDate)} –{' '}
        {formatDisplayDate(layers.analysisEndDate)})
      </small>

      {layers.chartLoading ? (
        <div className="chart-loading-box">
          <div className="chart-loading-spinner" aria-hidden="true" />
          <p className="chart-loading">Loading AOD data for {siteLabel}…</p>
          <p className="chart-loading-hint">Updating time series charts</p>
        </div>
      ) : layers.dailyMeanAod.length === 0 ? (
        <p className="aeronet-site-status aeronet-site-status--empty mt-3">
          {layers.chartError ?? 'No AOD measurements in this range for the selected site.'}
        </p>
      ) : (
        <Suspense fallback={<ChartLoadingFallback />}>
          <div
            className="charts-row mt-2"
            key={`${site.site}-${layers.analysisStartDate}-${layers.analysisEndDate}`}
          >
            <div className="chart-box">
              <div className="chart-container">
                <TimeSeriesChart
                  data={layers.dailyMeanAod}
                  startDate={dayjs(layers.analysisStartDate)}
                  endDate={dayjs(layers.analysisEndDate)}
                />
              </div>
            </div>
            <div className="chart-box">
              <div className="chart-container">
                <ScatterPlotChart data={layers.dailyMeanAod} />
              </div>
            </div>
            <div className="chart-box">
              <div className="chart-container">
                <WavelengthBarChart data={layers.dailyMeanAod} />
              </div>
            </div>
          </div>
        </Suspense>
      )}
    </div>
  );
};

export default DashboardV2AeronetTimeSeries;
