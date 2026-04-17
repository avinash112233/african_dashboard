import {
  PM25_COLORBAR_MAX,
  PM25_COLORBAR_MIN,
  pm25LegendGradientCss,
} from '../../utils/pm25Colormap';
import './PM25Colorbar.css';

interface PM25ColorbarProps {
  units?: string;
  /** When false, hide (e.g. while loading) */
  visible?: boolean;
}

const TICKS = [0, 20, 40, 60, 80, 100];

export default function PM25Colorbar({ units = 'µg/m³', visible = true }: PM25ColorbarProps) {
  if (!visible) return null;

  const gradient = pm25LegendGradientCss(PM25_COLORBAR_MIN, PM25_COLORBAR_MAX);

  return (
    <div className="pm25-colorbar" aria-hidden={false}>
      <div className="pm25-colorbar__title">PM2.5 ({units})</div>
      <div className="pm25-colorbar__track-wrap">
        <div className="pm25-colorbar__ticks">
          {[...TICKS].reverse().map((v) => (
            <span key={v} className="pm25-colorbar__tick-label">
              {v}
            </span>
          ))}
        </div>
        <div className="pm25-colorbar__track" style={{ background: gradient }} />
      </div>
      <div className="pm25-colorbar__units">0 - 100+</div>
    </div>
  );
}
