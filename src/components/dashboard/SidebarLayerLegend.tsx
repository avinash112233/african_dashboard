import {
  PM25_COLORBAR_MAX,
  PM25_COLORBAR_MIN,
  pm25LegendGradientHorizontal,
} from '../../utils/pm25Colormap';

interface SidebarLayerLegendProps {
  minLabel?: string;
  maxLabel?: string;
  min?: number;
  max?: number;
}

export default function SidebarLayerLegend({
  minLabel = '0',
  maxLabel = '100+',
  min = PM25_COLORBAR_MIN,
  max = PM25_COLORBAR_MAX,
}: SidebarLayerLegendProps) {
  return (
    <div className="sidebar-layer-legend" aria-hidden="true">
      <div
        className="sidebar-layer-legend-bar"
        style={{ background: pm25LegendGradientHorizontal(min, max) }}
      />
      <div className="sidebar-layer-legend-labels">
        <span>{minLabel}</span>
        <span>{maxLabel}</span>
      </div>
    </div>
  );
}
