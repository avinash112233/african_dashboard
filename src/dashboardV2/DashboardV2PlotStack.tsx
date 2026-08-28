import { lazy, Suspense } from 'react';
import dayjs from 'dayjs';
import ChartLoadingFallback from '../components/charts/ChartLoadingFallback';
import type { useDashboardV2Data } from './useDashboardV2Data';
import type { useDashboardV2LayerFeatures } from './useDashboardV2LayerFeatures';
import { formatDisplayDate } from '../utils/dateFormat';
import DashboardV2AeronetTimeSeries from './DashboardV2AeronetTimeSeries';

const FireCountTimeSeriesChart = lazy(() => import('../components/charts/FireCountTimeSeriesChart'));
const FireAverageFrpTimeSeriesChart = lazy(() => import('../components/charts/FireAverageFrpTimeSeriesChart'));
const FireBrightnessFrpScatterChart = lazy(() => import('../components/charts/FireBrightnessFrpScatterChart'));
const MERRA2StationTimeSeriesChart = lazy(() => import('../components/charts/MERRA2StationTimeSeriesChart'));
const OpenAqTimeSeriesChart = lazy(() => import('../components/charts/OpenAqTimeSeriesChart'));
const AAQEThreeDayForecastChart = lazy(() => import('../components/charts/AAQEThreeDayForecastChart'));
const WashUTimeSeriesChart = lazy(() => import('../components/charts/WashUTimeSeriesChart'));

type DashboardData = ReturnType<typeof useDashboardV2Data>;
type LayerFeatures = ReturnType<typeof useDashboardV2LayerFeatures>;

interface DashboardV2PlotStackProps {
  data: DashboardData;
  layers: LayerFeatures;
}

const DashboardV2PlotStack = ({ data, layers }: DashboardV2PlotStackProps) => {
  return (
    <>
      {data.showAeronet && layers.selectedSite && (
        <DashboardV2AeronetTimeSeries data={data} layers={layers} />
      )}

      {data.showFires && (data.fireLoading || layers.fireDailyStats.length > 0) && (
        <div className="plot-card charts-section">
          <div className="charts-section-header">
            <h6>Fire Hotspots Analysis</h6>
          </div>
          <small className="layer-tip dashboard-v2-chart-subtitle">
            Showing: {layers.fireRangeLabel} (
            {formatDisplayDate(layers.fireRangeStart.format('YYYY-MM-DD'))} –{' '}
            {formatDisplayDate(layers.fireRangeEnd.format('YYYY-MM-DD'))})
            {layers.fireChartBounds ? ' · filtered by map rectangle' : ''}
          </small>
          <Suspense fallback={<ChartLoadingFallback />}>
            <div className="charts-row">
              <div className="chart-box">
                <div className="chart-container">
                  <FireCountTimeSeriesChart
                    dailyStats={layers.fireDailyStats}
                    startDate={layers.fireRangeStart.startOf('day')}
                    endDate={layers.fireRangeEnd.startOf('day')}
                  />
                </div>
              </div>
              <div className="chart-box">
                <div className="chart-container">
                  <FireAverageFrpTimeSeriesChart
                    dailyStats={layers.fireDailyStats}
                    startDate={layers.fireRangeStart.startOf('day')}
                    endDate={layers.fireRangeEnd.startOf('day')}
                  />
                </div>
              </div>
              <div className="chart-box">
                <div className="chart-container">
                  <FireBrightnessFrpScatterChart points={layers.fireScatterPoints} />
                </div>
              </div>
            </div>
          </Suspense>
        </div>
      )}

      {data.showMERRA2PM25 && layers.selectedMerra2Station && (
        <div className="plot-card charts-section">
          <div className="charts-section-header">
            <h6>MERRA2 CNN PM2.5 Analysis</h6>
          </div>
          <small className="layer-tip dashboard-v2-chart-subtitle">
            Station: {layers.selectedMerra2Station.sitename} · Showing {layers.merra2AppliedRange.start} to{' '}
            {layers.merra2AppliedRange.end}
          </small>
          {layers.merra2SeriesLoading ? (
            <ChartLoadingFallback />
          ) : (
            <Suspense fallback={<ChartLoadingFallback />}>
              <div className="charts-row">
                <div className="chart-box" style={{ minWidth: 380 }}>
                  <div className="chart-container">
                    <MERRA2StationTimeSeriesChart
                      points={layers.merra2Series}
                      startDate={dayjs(layers.merra2AppliedRange.start)}
                      endDate={dayjs(layers.merra2AppliedRange.end)}
                    />
                  </div>
                </div>
              </div>
            </Suspense>
          )}
        </div>
      )}

      {data.showOpenAq && layers.selectedOpenAqStation && data.workflow === 'historical' && (
        <div className="plot-card charts-section">
          <div className="charts-section-header">
            <h6>OpenAQ Ground PM2.5 Analysis</h6>
          </div>
          <small className="layer-tip dashboard-v2-chart-subtitle">
            Station: {layers.selectedOpenAqStation.name} · Showing {layers.openAqAppliedRange.start} to{' '}
            {layers.openAqAppliedRange.end}
            {layers.openAqSeriesLoading ? ' · Loading history…' : ''}
          </small>
          {layers.openAqChartDisplayPoints.length === 0 && layers.openAqSeriesLoading ? (
            <ChartLoadingFallback />
          ) : layers.openAqChartDisplayPoints.length === 0 ? (
            <p className="layer-tip">
              No daily PM2.5 in this range.
              {layers.selectedOpenAqStation.datetimeLast
                ? ` Last reading: ${formatDisplayDate(layers.selectedOpenAqStation.datetimeLast.slice(0, 10))}.`
                : ''}
            </p>
          ) : (
            <Suspense fallback={<ChartLoadingFallback />}>
              <div className="charts-row">
                <div className="chart-box" style={{ minWidth: 380 }}>
                  <div className="chart-container">
                    <OpenAqTimeSeriesChart
                      points={layers.openAqChartDisplayPoints}
                      startDate={dayjs(layers.openAqAppliedRange.start)}
                      endDate={dayjs(layers.openAqAppliedRange.end)}
                    />
                  </div>
                </div>
              </div>
            </Suspense>
          )}
        </div>
      )}

      {data.showWashU && layers.activeSelectedWashuStation && (
        <div className="plot-card charts-section">
          <div className="charts-section-header">
            <h6>WashU SatPM2.5 station analysis</h6>
          </div>
          <small className="layer-tip dashboard-v2-chart-subtitle">
            Station: {layers.activeSelectedWashuStation.sitename} · {layers.washuPanelDataDate} · ACAG SatPM V6.GL.03
          </small>
          {layers.washuStationSeriesLoading ? (
            <ChartLoadingFallback />
          ) : (
            <Suspense fallback={<ChartLoadingFallback />}>
              <div className="charts-row">
                <div className="chart-box" style={{ minWidth: 380 }}>
                  <div className="chart-container">
                    <WashUTimeSeriesChart
                      points={layers.washuStationSeries}
                      startYear={layers.washuAppliedSeriesRange.startYear}
                      startMonth={layers.washuAppliedSeriesRange.startMonth}
                      endYear={layers.washuAppliedSeriesRange.endYear}
                      endMonth={layers.washuAppliedSeriesRange.endMonth}
                      granularity={layers.washuStationSeriesGranularity}
                      title={`WashU SatPM2.5 · ${layers.activeSelectedWashuStation.sitename}`}
                    />
                  </div>
                </div>
              </div>
            </Suspense>
          )}
        </div>
      )}

      {data.showWashU && layers.washuPin && (
        <div className="plot-card charts-section">
          <div className="charts-section-header">
            <h6>WashU monthly PM2.5 time series</h6>
          </div>
          <small className="layer-tip dashboard-v2-chart-subtitle">
            Location: {layers.washuPin.lat.toFixed(3)}°, {layers.washuPin.lon.toFixed(3)}° · ACAG SatPM V6.GL.03
          </small>
          {layers.washuSeriesError && (
            <p className="layer-tip layer-tip-warn">⚠ {layers.washuSeriesError}</p>
          )}
          {layers.washuSeriesLoading ? (
            <ChartLoadingFallback />
          ) : (
            <Suspense fallback={<ChartLoadingFallback />}>
              <div className="charts-row">
                <div className="chart-box" style={{ minWidth: 380 }}>
                  <div className="chart-container">
                    <WashUTimeSeriesChart
                      points={layers.washuSeries}
                      startYear={layers.washuAppliedSeriesRange.startYear}
                      startMonth={layers.washuAppliedSeriesRange.startMonth}
                      endYear={layers.washuAppliedSeriesRange.endYear}
                      endMonth={layers.washuAppliedSeriesRange.endMonth}
                      title={`WashU PM2.5 · ${layers.washuPin.lat.toFixed(2)}°, ${layers.washuPin.lon.toFixed(2)}°`}
                    />
                  </div>
                </div>
              </div>
            </Suspense>
          )}
        </div>
      )}

      {data.showAAQEForecast &&
        layers.activeSelectedAAQE &&
        layers.aaqeThreeDaySeries.length > 0 && (
          <div className="plot-card charts-section">
            <div className="charts-section-header">
              <h6>
                {(layers.activeSelectedAAQE.siteName ?? 'Forecast Site')} (African AQE) · 3-Day Forecast
              </h6>
            </div>
            <Suspense fallback={<ChartLoadingFallback />}>
              <div className="charts-row">
                <div className="chart-box" style={{ minWidth: 380 }}>
                  <div className="chart-container">
                    <AAQEThreeDayForecastChart points={layers.aaqeThreeDaySeries} />
                  </div>
                </div>
              </div>
            </Suspense>
          </div>
        )}

    </>
  );
};

export default DashboardV2PlotStack;
