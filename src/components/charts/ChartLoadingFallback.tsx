/** Lightweight placeholder while lazy-loaded charts download. */
const ChartLoadingFallback = () => (
  <div
    className="chart-loading-box"
    style={{ minHeight: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
  >
    <div className="chart-loading-spinner" />
  </div>
);

export default ChartLoadingFallback;
