/**
 * CircleFireTable – NASA FIRMS-style table of fire points inside selected circle
 */

import type { FIRMSFirePoint } from '../../services/firmsApi';

interface CircleFireTableProps {
  points: FIRMSFirePoint[];
  onFireClick?: (fire: FIRMSFirePoint) => void;
  onClose?: () => void;
}

export default function CircleFireTable({ points, onFireClick, onClose }: CircleFireTableProps) {
  const maxRows = 500;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 48,
        left: 10,
        right: 10,
        maxHeight: '320px',
        background: 'rgba(45, 55, 72, 0.96)',
        borderRadius: 8,
        boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
        zIndex: 900,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '10px 14px',
          background: '#2d3748',
          color: '#fff',
          fontSize: 13,
          fontWeight: 600,
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <span>
          VIIRS NOAA-21 [375m] • {points.length} point{points.length !== 1 ? 's' : ''} in selection
          {points.length > maxRows && ` (showing first ${maxRows})`}
        </span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              flexShrink: 0,
              background: 'rgba(255,255,255,0.15)',
              border: 'none',
              color: '#fff',
              borderRadius: 4,
              width: 28,
              height: 28,
              cursor: 'pointer',
              fontSize: 16,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        )}
      </div>
      <div style={{ overflowY: 'auto', maxHeight: 260, fontSize: 11 }}>
        {points.length === 0 ? (
          <p style={{ padding: 16, color: '#94a3b8', margin: 0 }}>No fire hotspots in this area.</p>
        ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', color: '#e2e8f0' }}>
          <thead style={{ position: 'sticky', top: 0, background: '#374151', zIndex: 1 }}>
            <tr>
              <th style={{ padding: '6px 8px', textAlign: 'left' }}>LATITUDE</th>
              <th style={{ padding: '6px 8px', textAlign: 'left' }}>LONGITUDE</th>
              <th style={{ padding: '6px 8px', textAlign: 'left' }}>ACQUIRE_TIME</th>
              <th style={{ padding: '6px 8px', textAlign: 'left' }}>SATELLITE</th>
              <th style={{ padding: '6px 8px', textAlign: 'left' }}>CONFIDENCE</th>
              <th style={{ padding: '6px 8px', textAlign: 'left' }}>DAYNIGHT</th>
              <th style={{ padding: '6px 8px', textAlign: 'left' }}>FRP</th>
            </tr>
          </thead>
          <tbody>
            {points.slice(0, maxRows).map((p, i) => (
              <tr
                key={`${p.latitude}-${p.longitude}-${p.acq_time}-${i}`}
                style={{
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                  cursor: onFireClick ? 'pointer' : 'default',
                }}
                onClick={() => onFireClick?.(p)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                <td style={{ padding: '4px 8px' }}>{p.latitude.toFixed(6)}</td>
                <td style={{ padding: '4px 8px' }}>{p.longitude.toFixed(6)}</td>
                <td style={{ padding: '4px 8px' }}>
                  {p.acq_date} {p.acq_time || ''}
                </td>
                <td style={{ padding: '4px 8px' }}>{p.satellite || 'N/A'}</td>
                <td style={{ padding: '4px 8px' }}>{p.confidence || 'nominal'}</td>
                <td style={{ padding: '4px 8px' }}>{p.daynight || 'N/A'}</td>
                <td style={{ padding: '4px 8px' }}>{p.frp != null ? p.frp.toFixed(2) : 'N/A'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        )}
      </div>
    </div>
  );
}
