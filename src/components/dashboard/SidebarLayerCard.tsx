import type { ReactNode } from 'react';

interface SidebarLayerCardProps {
  title: string;
  subtitle?: string;
  meta?: string;
  visible?: boolean;
  onToggleVisible?: () => void;
  legend?: ReactNode;
  children?: ReactNode;
}

export default function SidebarLayerCard({
  title,
  subtitle,
  meta,
  visible = true,
  onToggleVisible,
  legend,
  children,
}: SidebarLayerCardProps) {
  return (
    <div className={`sidebar-layer-card${visible ? ' sidebar-layer-card--visible' : ''}`}>
      <div className="sidebar-layer-card-head">
        {onToggleVisible ? (
          <button
            type="button"
            className="sidebar-layer-visibility"
            aria-label={visible ? 'Hide layer' : 'Show layer'}
            aria-pressed={visible}
            onClick={onToggleVisible}
          >
            {visible ? '👁' : '👁‍🗨'}
          </button>
        ) : (
          <span className="sidebar-layer-visibility sidebar-layer-visibility--static" aria-hidden="true">
            👁
          </span>
        )}
        <div className="sidebar-layer-card-titles">
          <div className="sidebar-layer-card-title">{title}</div>
          {subtitle && <div className="sidebar-layer-card-subtitle">{subtitle}</div>}
          {meta && <div className="sidebar-layer-card-meta">{meta}</div>}
        </div>
      </div>
      {visible && legend}
      {visible && children}
    </div>
  );
}
