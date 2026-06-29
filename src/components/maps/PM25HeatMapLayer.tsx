/**
 * MERRA2 PM2.5 – single ImageOverlay painted once from the grid (fast).
 * Previously used a per-tile GridLayer that repainted every pixel on each zoom — very slow.
 */

import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { getMERRA2PM25Grid, type MERRA2PM25GridResponse } from '../../services/merra2Api';
import { renderPm25GridToDataUrl, samplePm25AtLatLon } from '../../utils/pm25Colormap';
import './PM25HeatMapLayer.css';

export interface PM25Sample {
  lat: number;
  lon: number;
  value: number;
  date: string;
  min: number;
  max: number;
  units: string;
  source: 'gesdisc' | 'sample';
}

interface PM25HeatMapLayerProps {
  date: string;
  opacity?: number;
  onPm25Sample?: (sample: PM25Sample | null) => void;
  onLoadingChange?: (loading: boolean) => void;
  onSourceChange?: (source: 'gesdisc' | 'sample', fallbackReason?: string) => void;
}

const PM25HeatMapLayer = ({
  date,
  opacity = 0.65,
  onPm25Sample,
  onLoadingChange,
  onSourceChange,
}: PM25HeatMapLayerProps) => {
  const map = useMap();
  const overlayRef = useRef<L.ImageOverlay | null>(null);
  const gridRef = useRef<MERRA2PM25GridResponse | null>(null);
  const moveHandlerRef = useRef<((e: L.LeafletMouseEvent) => void) | null>(null);
  const onPm25SampleRef = useRef(onPm25Sample);
  const onLoadingChangeRef = useRef(onLoadingChange);
  const onSourceChangeRef = useRef(onSourceChange);
  onPm25SampleRef.current = onPm25Sample;
  onLoadingChangeRef.current = onLoadingChange;
  onSourceChangeRef.current = onSourceChange;

  useEffect(() => {
    if (!map) return;

    let cancelled = false;
    onLoadingChangeRef.current?.(true);

    getMERRA2PM25Grid(date)
      .then((grid) => {
        if (cancelled || !map) return;
        onSourceChangeRef.current?.(grid.source, grid.fallbackReason);
        gridRef.current = grid;

        const dataUrl = renderPm25GridToDataUrl(grid);
        if (!dataUrl) {
          onLoadingChangeRef.current?.(false);
          return;
        }

        const { south, west, north, east } = grid.bounds;
        const overlay = L.imageOverlay(dataUrl, L.latLngBounds([south, west], [north, east]), {
          opacity,
          pane: 'overlayPane',
          className: 'pm25-image-overlay',
          interactive: false,
        });
        overlay.addTo(map);
        overlayRef.current = overlay;

        const emitSample = (latlng: L.LatLng) => {
          const g = gridRef.current;
          if (!g) return;
          const value = samplePm25AtLatLon(g, latlng.lat, latlng.lng);
          if (value == null) {
            onPm25SampleRef.current?.(null);
            return;
          }
          onPm25SampleRef.current?.({
            lat: latlng.lat,
            lon: latlng.lng,
            value,
            date: g.date,
            min: g.min,
            max: g.max,
            units: g.units,
            source: g.source,
          });
        };

        const handleMove = (e: L.LeafletMouseEvent) => emitSample(e.latlng);
        moveHandlerRef.current = handleMove;
        map.on('mousemove', handleMove);
        onLoadingChangeRef.current?.(false);
      })
      .catch((err) => {
        console.error('[PM25HeatMapLayer] Failed to load grid:', err);
        onLoadingChangeRef.current?.(false);
      });

    return () => {
      cancelled = true;
      onLoadingChangeRef.current?.(false);
      onPm25SampleRef.current?.(null);
      gridRef.current = null;
      if (moveHandlerRef.current) map.off('mousemove', moveHandlerRef.current);
      moveHandlerRef.current = null;
      if (overlayRef.current) {
        map.removeLayer(overlayRef.current);
        overlayRef.current = null;
      }
    };
  }, [map, date, opacity]);

  return null;
};

export default PM25HeatMapLayer;
