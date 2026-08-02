import type { DashboardV2LayerKey } from './config';
import type { DashboardV2Product } from './config';

interface DashboardV2LayerTogglesProps {
  products: DashboardV2Product[];
  activeLayers: DashboardV2LayerKey[];
  primaryLayer: DashboardV2LayerKey;
  onToggleLayer: (layer: DashboardV2LayerKey) => void;
  compact?: boolean;
}

const DashboardV2LayerToggles = ({
  products,
  activeLayers,
  primaryLayer,
  onToggleLayer,
  compact = false,
}: DashboardV2LayerTogglesProps) => {
  const uniqueLayers = products.filter(
    (product, index, list) => list.findIndex((p) => p.layer === product.layer) === index
  );

  return (
    <div className={`dashboard-v2-layer-toggles${compact ? ' dashboard-v2-layer-toggles--compact' : ''}`}>
      {!compact && (
        <>
          <label className="form-label dashboard-v2-layer-toggles-label">Map overlays</label>
          <p className="mini-note mb-2">
            Turn layers on or off to reduce clutter. At least one layer must stay visible.
          </p>
        </>
      )}
      <div className="dashboard-v2-layer-toggle-list" role="group" aria-label="Map overlay layers">
        {uniqueLayers.map((product) => {
          const isOn = activeLayers.includes(product.layer);
          const isPrimary = primaryLayer === product.layer;
          const isLastOn = isOn && activeLayers.length <= 1;
          return (
            <label
              key={product.layer}
              className={`dashboard-v2-layer-toggle${isOn ? ' dashboard-v2-layer-toggle--on' : ''}${
                isPrimary ? ' dashboard-v2-layer-toggle--primary' : ''
              }`}
            >
              <input
                type="checkbox"
                checked={isOn}
                disabled={isLastOn}
                onChange={() => onToggleLayer(product.layer)}
              />
              <span className="dashboard-v2-layer-toggle-text">{product.label}</span>
              {isPrimary && isOn && (
                <span className="dashboard-v2-layer-toggle-badge">Primary</span>
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
};

export default DashboardV2LayerToggles;
