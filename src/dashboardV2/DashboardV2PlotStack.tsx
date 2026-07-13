import { lazy, Suspense } from 'react';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import dayjs from 'dayjs';
import ChartLoadingFallback from '../components/charts/ChartLoadingFallback';
import type { useDashboardV2Data } from './useDashboardV2Data';
import type { useDashboardV2LayerFeatures } from './useDashboardV2LayerFeatures';
import { formatDisplayDate } from '../utils/dateFormat';
import type { AnalysisRange, FireAnalysisRange } from './types';

const TimeSeriesChart = lazy(() => import('../components/charts/TimeSeriesChart'));
const ScatterPlotChart = lazy(() => import('../components/charts/ScatterPlotChart'));
const WavelengthBarChart = lazy(() => import('../components/charts/WavelengthBarChart'));
const FireCountTimeSeriesChart = lazy(() => import('../components/charts/FireCountTimeSeriesChart'));
const FireAverageFrpTimeSeriesChart = lazy(() => import('../components/charts/FireAverageFrpTimeSeriesChart'));
const FireBrightnessFrpScatterChart = lazy(() => import('../components/charts/FireBrightnessFrpScatterChart'));
const MERRA2StationTimeSeriesChart = lazy(() => import('../components/charts/MERRA2StationTimeSeriesChart'));
const OpenAqTimeSeriesChart = lazy(() => import('../components/charts/OpenAqTimeSeriesChart'));
const AAQEThreeDayForecastChart = lazy(() => import('../components/charts/AAQEThreeDayForecastChart'));
const WashUTimeSeriesChart = lazy(() => import('../components/charts/WashUTimeSeriesChart'));
const AnalysisPanel = lazy(() => import('../components/analysis/AnalysisPanel'));

type DashboardData = ReturnType<typeof useDashboardV2Data>;
type LayerFeatures = ReturnType<typeof useDashboardV2LayerFeatures>;

interface DashboardV2PlotStackProps {
  data: DashboardData;
  layers: LayerFeatures;
}

const DashboardV2PlotStack = ({ data, layers }: DashboardV2PlotStackProps) => {
  return (
    <>
      {data.showAeronet && layers.selectedSite && (layers.chartLoading || layers.dailyMeanAod.length > 0) && (
        <div className="d1-plot-card charts-section">
          <div className="charts-section-header">
            <h6>Time Series Analysis</h6>
            <div className="d1-chart-controls">
              <span className="d1-chart-controls-label">Range</span>
              <select
                className="site-select d1-chart-select"
                value={layers.analysisRange}
                onChange={(e) => layers.setAnalysisRange(e.target.value as AnalysisRange)}
                aria-label="Analysis Range"
              >
                <option value="7D">Last 7 Days</option>
                <option value="30D">Last 30 Days</option>
                <option value="90D">Last 90 Days</option>
              </select>
            </div>
          </div>
          <small className="layer-tip d1-chart-subtitle">
            Showing: {layers.analysisRangeLabel} ({formatDisplayDate(layers.analysisStartDate)} –{' '}
            {formatDisplayDate(layers.analysisEndDate)})
          </small>
          {layers.chartLoading ? (
            <ChartLoadingFallback />
          ) : (
            <Suspense fallback={<ChartLoadingFallback />}>
              <div className="charts-row">
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
      )}

      {data.showFires && (data.fireLoading || layers.fireDailyStats.length > 0) && (
        <div className="d1-plot-card charts-section">
          <div className="charts-section-header">
            <h6>Fire Hotspots Analysis</h6>
            <div className="d1-chart-controls">
              <span className="d1-chart-controls-label">Range</span>
              <select
                className="site-select d1-chart-select"
                value={layers.fireAnalysisRange}
                onChange={(e) => layers.setFireAnalysisRange(e.target.value as FireAnalysisRange)}
                aria-label="Fire Analysis Range"
              >
                <option value="24H">Last 24 Hours</option>
                <option value="48H">Last 48 Hours</option>
                <option value="7D">Last 7 Days</option>
              </select>
            </div>
          </div>
          <small className="layer-tip d1-chart-subtitle">
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
        <div className="d1-plot-card charts-section">
          <div className="charts-section-header">
            <h6>MERRA2 CNN PM2.5 Analysis</h6>
            <div className="d1-chart-controls d1-chart-controls--wide">
              <DatePicker
                label="From"
                value={layers.merra2DateFrom}
                onChange={(d) => d && layers.setMerra2DateFrom(d)}
                slotProps={{ textField: { size: 'small' } }}
              />
              <DatePicker
                label="To"
                value={layers.merra2DateTo}
                onChange={(d) => d && layers.setMerra2DateTo(d)}
                slotProps={{ textField: { size: 'small' } }}
              />
              <button type="button" className="d1-btn-outline" onClick={layers.applyMerra2Range}>
                Apply
              </button>
              <button type="button" className="d1-btn-outline" onClick={layers.resetMerra2Range}>
                Reset
              </button>
            </div>
          </div>
          <small className="layer-tip d1-chart-subtitle">
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
        <div className="d1-plot-card charts-section">
          <div className="charts-section-header">
            <h6>OpenAQ Ground PM2.5 Analysis</h6>
            <div className="d1-chart-controls d1-chart-controls--wide">
              <DatePicker
                label="From"
                value={layers.openAqDateFrom}
                onChange={(d) => d && layers.setOpenAqDateFrom(d)}
                slotProps={{ textField: { size: 'small' } }}
              />
              <DatePicker
                label="To"
                value={layers.openAqDateTo}
                onChange={(d) => d && layers.setOpenAqDateTo(d)}
                slotProps={{ textField: { size: 'small' } }}
              />
              <button type="button" className="d1-btn-outline" onClick={layers.applyOpenAqRange}>
                Apply
              </button>
              <button type="button" className="d1-btn-outline" onClick={layers.resetOpenAqRange}>
                Reset
              </button>
            </div>
          </div>
          <small className="layer-tip d1-chart-subtitle">
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

      {data.showWashU && layers.washuPin && (
        <div className="d1-plot-card charts-section">
          <div className="charts-section-header">
            <h6>WashU monthly PM2.5 time series</h6>
            <div className="d1-chart-controls d1-chart-controls--wide">
              <label className="layer-tip mb-0">
                From
                <input
                  type="number"
                  min={1998}
                  max={2023}
                  value={layers.washuSeriesStartYear}
                  onChange={(e) => layers.setWashuSeriesStartYear(Number(e.target.value))}
                  className="site-select d1-chart-select d-inline-block ms-1"
                  style={{ width: 72 }}
                />
                /
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={layers.washuSeriesStartMonth}
                  onChange={(e) => layers.setWashuSeriesStartMonth(Number(e.target.value))}
                  className="site-select d1-chart-select d-inline-block ms-1"
                  style={{ width: 52 }}
                />
              </label>
              <label className="layer-tip mb-0">
                To
                <input
                  type="number"
                  min={1998}
                  max={2023}
                  value={layers.washuSeriesEndYear}
                  onChange={(e) => layers.setWashuSeriesEndYear(Number(e.target.value))}
                  className="site-select d1-chart-select d-inline-block ms-1"
                  style={{ width: 72 }}
                />
                /
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={layers.washuSeriesEndMonth}
                  onChange={(e) => layers.setWashuSeriesEndMonth(Number(e.target.value))}
                  className="site-select d1-chart-select d-inline-block ms-1"
                  style={{ width: 52 }}
                />
              </label>
              <button type="button" className="d1-btn-outline" onClick={layers.applyWashuSeriesRange}>
                Apply
              </button>
            </div>
          </div>
          <small className="layer-tip d1-chart-subtitle">
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
          <div className="d1-plot-card charts-section">
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

      {layers.showAnalysisSection && layers.analysisAnchor && (
        <div className="d1-plot-card">
          <Suspense fallback={<ChartLoadingFallback />}>
            <AnalysisPanel
              location={layers.analysisAnchor}
              startDate={layers.analysisStartDate}
              endDate={layers.analysisEndDate}
              aeronetAodVersion={layers.aeronetAodVersion}
              analysisRange={layers.analysisRange}
              onAnalysisRangeChange={layers.setAnalysisRange}
              onClearAnchor={layers.clearAnalysisAnchor}
              preloadedStations={data.merra2Stations}
              chartsLayout="inline"
            />
          </Suspense>
        </div>
      )}
    </>
  );
};

export default DashboardV2PlotStack;
