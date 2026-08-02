import { useMemo } from 'react';
import dayjs from 'dayjs';
import type { useDashboardV2Data } from './useDashboardV2Data';
import type { useDashboardV2LayerFeatures } from './useDashboardV2LayerFeatures';
import type { FireAnalysisRange, PlotRangePreset } from './types';
import { formatDateMonthDayYear } from '../utils/dateFormat';
import {
  formatWashuMonthRange,
  getWashuAnchorMonth,
  getWashuRelativeMonthRange,
  matchWashuMonthPreset,
  toWashuMonthInputValue,
  WASHU_ARCHIVE_MAX,
  WASHU_ARCHIVE_MIN,
  WASHU_MONTH_PRESETS,
} from './washuPlotRange';

type DashboardData = ReturnType<typeof useDashboardV2Data>;
type LayerFeatures = ReturnType<typeof useDashboardV2LayerFeatures>;

interface DashboardV2PlottingPanelProps {
  data: DashboardData;
  layers: LayerFeatures;
}

const PLOT_RANGE_PRESETS: { id: PlotRangePreset; label: string }[] = [
  { id: '7D', label: '7D' },
  { id: '30D', label: '30D' },
  { id: '90D', label: '90D' },
];

const DashboardV2PlottingPanel = ({
  data,
  layers,
}: DashboardV2PlottingPanelProps) => {
  const washuPlotMode = data.showWashU && layers.washuPin != null;
  const showFireRangeControls = data.showFires;
  const washuAnchorMonth = getWashuAnchorMonth(data.washuPeriodParts.year, data.washuPeriodParts.month);
  const washuAnchorLabel = dayjs(`${washuAnchorMonth}-01`).format('MMM YYYY');

  const washuPresetRanges = useMemo(
    () =>
      WASHU_MONTH_PRESETS.map((preset) => ({
        ...preset,
        range: getWashuRelativeMonthRange(washuAnchorMonth, preset.months),
      })),
    [washuAnchorMonth]
  );

  const activeWashuPresetId = matchWashuMonthPreset(layers.washuAppliedSeriesRange, washuAnchorMonth);

  const washuStartMonthValue = toWashuMonthInputValue(
    layers.washuDraftSeriesRange.startYear,
    layers.washuDraftSeriesRange.startMonth
  );
  const washuEndMonthValue = toWashuMonthInputValue(
    layers.washuDraftSeriesRange.endYear,
    layers.washuDraftSeriesRange.endMonth
  );

  return (
    <section className="panel-card dashboard-v2-plotting-panel">
      <div className="panel-title">
        <i className="bi bi-bar-chart-line" aria-hidden="true" /> Plotting panel
      </div>

      {washuPlotMode ? (
        <>
          <label className="form-label">Monthly chart range</label>
          <p className="help-text dashboard-v2-washu-range-note mb-2">
            Relative to map month ({washuAnchorLabel}). Presets count back from that month.
          </p>

          <div className="dashboard-v2-plot-range-presets mb-2">
            {washuPresetRanges.map(({ id, label, range }) => (
              <button
                key={id}
                type="button"
                className={`dashboard-v2-plot-range-btn${activeWashuPresetId === id ? ' active' : ''}`}
                onClick={() => layers.applyWashuSeriesPreset(range)}
              >
                Last {label}
              </button>
            ))}
          </div>

          <div className="row g-2 mb-2">
            <div className="col-6">
              <label className="form-label" htmlFor="v2-washu-start-month">
                From
              </label>
              <input
                id="v2-washu-start-month"
                type="month"
                className="form-control"
                min={WASHU_ARCHIVE_MIN}
                max={washuEndMonthValue}
                value={washuStartMonthValue}
                onChange={(e) => layers.setWashuSeriesStartMonthInput(e.target.value)}
              />
            </div>
            <div className="col-6">
              <label className="form-label" htmlFor="v2-washu-end-month">
                To
              </label>
              <input
                id="v2-washu-end-month"
                type="month"
                className="form-control"
                min={washuStartMonthValue}
                max={WASHU_ARCHIVE_MAX}
                value={washuEndMonthValue}
                onChange={(e) => layers.setWashuSeriesEndMonthInput(e.target.value)}
              />
            </div>
          </div>

          <div className="d-flex gap-2 mb-3">
            <button
              type="button"
              className="btn btn-outline-aaqe flex-fill dashboard-v2-plot-apply-btn"
              onClick={layers.applyWashuSeriesRange}
            >
              Apply
            </button>
            <button
              type="button"
              className="btn btn-outline-aaqe flex-fill"
              onClick={layers.resetWashuSeriesRange}
            >
              Reset
            </button>
          </div>

          <div className="mini-note mb-3">
            Active: {formatWashuMonthRange(layers.washuAppliedSeriesRange)}
            {layers.washuSeriesRangePending && (
              <> · Click Apply to update the chart with the selected months.</>
            )}
          </div>
        </>
      ) : (
        <>
          {data.showWashU && (
            <p className="help-text dashboard-v2-washu-range-note mb-3">
              Click the map to pick a location for the WashU monthly time series.
            </p>
          )}

          <label className="form-label">Analysis range</label>
          <div className="dashboard-v2-plot-range-presets mb-2">
            {PLOT_RANGE_PRESETS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                className={`dashboard-v2-plot-range-btn${data.plotRangeMode === id ? ' active' : ''}`}
                onClick={() => data.setPlotRangePreset(id)}
              >
                Last {label}
              </button>
            ))}
          </div>
          {data.plotRangeMode === 'custom' && (
            <div className="dashboard-v2-plot-range-custom-note mb-2">Custom range</div>
          )}

          <label className="form-label">Customize range</label>
          <div className="row g-2 mb-2">
            <div className="col-6">
              <label className="form-label" htmlFor="v2-plot-start">
                From
              </label>
              <input
                id="v2-plot-start"
                type="date"
                className="form-control"
                value={data.plotStartDate}
                max={data.plotEndDate}
                onChange={(e) => data.setPlotStartDate(e.target.value)}
              />
            </div>
            <div className="col-6">
              <label className="form-label" htmlFor="v2-plot-end">
                To
              </label>
              <input
                id="v2-plot-end"
                type="date"
                className="form-control"
                value={data.plotEndDate}
                min={data.plotStartDate}
                onChange={(e) => data.setPlotEndDate(e.target.value)}
              />
            </div>
          </div>

          <div className="d-flex gap-2 mb-3">
            <button
              type="button"
              className="btn btn-outline-aaqe flex-fill dashboard-v2-plot-apply-btn"
              onClick={data.applyPlotRange}
            >
              Apply
            </button>
            <button
              type="button"
              className="btn btn-outline-aaqe flex-fill"
              onClick={() => data.setPlotRangePreset('7D')}
            >
              Reset
            </button>
          </div>

          <div className="mini-note mb-3">
            Active: {formatDateMonthDayYear(data.effectivePlotStartDate)} –{' '}
            {formatDateMonthDayYear(data.effectivePlotEndDate)}
            {data.plotRangePending && (
              <> · Click Apply to update charts with the selected range.</>
            )}
          </div>
        </>
      )}

      {showFireRangeControls && (
        <>
          <label className="form-label" htmlFor="v2-fire-range">
            Fire analysis range
          </label>
          <select
            id="v2-fire-range"
            className="form-select mb-3"
            value={layers.fireAnalysisRange}
            onChange={(e) => layers.setFireAnalysisRange(e.target.value as FireAnalysisRange)}
          >
            <option value="24H">Last 24 hours</option>
            <option value="48H">Last 48 hours</option>
            <option value="7D">Last 7 days</option>
          </select>
        </>
      )}

      {!washuPlotMode && (
        <div className="mini-note mb-3">
          Charts use each layer&apos;s native resolution (daily PM2.5, monthly WashU, etc.).
        </div>
      )}

      <div className="d-grid gap-2">
        <button type="button" className="btn btn-outline-aaqe" disabled>
          <i className="bi bi-filetype-csv me-1" aria-hidden="true" />
          Download plot CSV
        </button>
        <button type="button" className="btn btn-outline-aaqe" disabled>
          <i className="bi bi-grid-3x3-gap me-1" aria-hidden="true" />
          Download heat map CSV
        </button>
      </div>
    </section>
  );
};

export default DashboardV2PlottingPanel;
