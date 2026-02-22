/**
 * ViewportFirePanel – shows histogram-like table of fire points in viewport when zoomed in
 */

import { useState, useMemo } from 'react';
import { useMap, useMapEvents } from 'react-leaflet';
import type { FIRMSFirePoint } from '../../services/firmsApi';

interface ViewportFirePanelProps {
  firePoints: FIRMSFirePoint[];
  onFireClick?: (fire: FIRMSFirePoint) => void;
  minZoomToShow?: number;
}

export default function ViewportFirePanel({
  firePoints,
  onFireClick,
  minZoomToShow = 7,
}: ViewportFirePanelProps) {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  const [bounds, setBounds] = useState(() => {
    const b = map.getBounds();
    return { north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() };
  });

  useMapEvents({
    zoomend: () => setZoom(map.getZoom()),
    moveend: () => {
      const b = map.getBounds();
      setBounds({ north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() });
    },
  });

  const pointsInView = useMemo(() => {
    if (!bounds || firePoints.length === 0 || zoom < minZoomToShow) return [];
    return firePoints.filter((p) => {
      if (isNaN(p.latitude) || isNaN(p.longitude)) return false;
      return p.latitude >= bounds.south && p.latitude <= bounds.north && p.longitude >= bounds.west && p.longitude <= bounds.east;
    });
  }, [firePoints, bounds, zoom, minZoomToShow]);

  if (zoom < minZoomToShow || pointsInView.length === 0) return null;

  const maxRows = 100;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 48,
        left: 10,
        right: 10,
        maxHeight: '280px',
        background: 'rgba(255,255,255,0.97)',
        borderRadius: 8,
        boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
        zIndex: 900,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '10px 14px',
          background: '#2c3e50',
          color: 'white',
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        VIIRS / NOAA-20 [375m] • {pointsInView.length} points in view{pointsInView.length > maxRows ? ` (showing first ${maxRows})` : ''}
      </div>
      <div style={{ overflowY: 'auto', maxHeight: 220, fontSize: 11 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ position: 'sticky', top: 0, background: '#f5f5f5', zIndex: 1 }}>
            <tr>
              <th style={{ padding: '6px 8px', textAlign: 'left' }}>LAT</th>
              <th style={{ padding: '6px 8px', textAlign: 'left' }}>LON</th>
              <th style={{ padding: '6px 8px', textAlign: 'left' }}>BRIGHT_TI4</th>
              <th style={{ padding: '6px 8px', textAlign: 'left' }}>TIME</th>
              <th style={{ padding: '6px 8px', textAlign: 'left' }}>FRP</th>
            </tr>
          </thead>
          <tbody>
            {pointsInView.slice(0, maxRows).map((p, i) => (
              <tr
                key={`${p.latitude}-${p.longitude}-${i}`}
                style={{ borderBottom: '1px solid #eee', cursor: onFireClick ? 'pointer' : 'default' }}
                onClick={() => onFireClick?.(p)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#f0f0f0';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                <td style={{ padding: '4px 8px' }}>{p.latitude.toFixed(4)}</td>
                <td style={{ padding: '4px 8px' }}>{p.longitude.toFixed(4)}</td>
                <td style={{ padding: '4px 8px' }}>{p.bright_ti4 != null ? p.bright_ti4.toFixed(1) : 'N/A'}</td>
                <td style={{ padding: '4px 8px' }}>{p.acq_date} {p.acq_time || ''}</td>
                <td style={{ padding: '4px 8px' }}>{p.frp != null ? p.frp.toFixed(1) : 'N/A'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
