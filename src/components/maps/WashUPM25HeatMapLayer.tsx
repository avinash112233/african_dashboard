/**
 * WashU ACAG SatPM2.5 – Africa fine-resolution grid overlay (monthly / annual).
 * Renders a lightly upsampled heatmap — crisp coastlines, modest cell softening.
 */

import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { loadWashUGrid, type WashUPeriod, type WashUPM25Sample } from '../../services/washuApi';
import { renderWashUGridLightSmoothWithColorFn, samplePm25AtLatLon } from '../../utils/pm25Colormap';
import { washuPm25ToRgb, WASHU_COLORBAR_MIN, WASHU_COLORBAR_MAX } from '../../utils/washuColormap';
import './PM25HeatMapLayer.css';

export type { WashUPM25Sample };

interface WashUPM25HeatMapLayerProps {
  period: WashUPeriod;
  year: number;
  month: number | null;
  opacity?: number;
  onPm25Sample?: (sample: WashUPM25Sample | null) => void;
  onLoadingChange?: (loading: boolean) => void;
  onSourceChange?: (source: 'satpm' | 'sample', fallbackReason?: string) => void;
  onMapClick?: (lat: number, lon: number) => void;
}

const WashUPM25HeatMapLayer = ({
  period,
  year,
  month,
  opacity = 0.72,
  onPm25Sample,
  onLoadingChange,
  onSourceChange,
  onMapClick,
}: WashUPM25HeatMapLayerProps) => {
  const map = useMap();
  const overlayRef = useRef<L.ImageOverlay | null>(null);
  const gridRef = useRef<Awaited<ReturnType<typeof loadWashUGrid>> | null>(null);
  const moveHandlerRef = useRef<((e: L.LeafletMouseEvent) => void) | null>(null);
  const clickHandlerRef = useRef<((e: L.LeafletMouseEvent) => void) | null>(null);
  const onPm25SampleRef = useRef(onPm25Sample);
  const onLoadingChangeRef = useRef(onLoadingChange);
  const onSourceChangeRef = useRef(onSourceChange);
  const onMapClickRef = useRef(onMapClick);
  onPm25SampleRef.current = onPm25Sample;
  onLoadingChangeRef.current = onLoadingChange;
  onSourceChangeRef.current = onSourceChange;
  onMapClickRef.current = onMapClick;

  useEffect(() => {
    if (!map) return;

    let cancelled = false;
    onLoadingChangeRef.current?.(true);

    loadWashUGrid(period, year, month)
      .then((grid) => {
        if (cancelled || !map) return;
        gridRef.current = grid;
        onSourceChangeRef.current?.(grid.source, grid.fallbackReason);

        const dataUrl = renderWashUGridLightSmoothWithColorFn(
          grid,
          3,
          WASHU_COLORBAR_MIN,
          WASHU_COLORBAR_MAX,
          washuPm25ToRgb
        );
        if (!dataUrl) return;

        const { south, west, north, east } = grid.bounds;
        const bounds = L.latLngBounds([south, west], [north, east]);

        if (overlayRef.current) {
          map.removeLayer(overlayRef.current);
          overlayRef.current = null;
        }

        const overlay = L.imageOverlay(dataUrl, bounds, {
          opacity,
          pane: 'overlayPane',
          className: 'pm25-image-overlay washu-image-overlay--light',
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
            period: g.period,
            periodLabel: g.periodLabel,
            min: g.min,
            max: g.max,
            units: g.units,
            source: g.source,
          });
        };

        if (moveHandlerRef.current) map.off('mousemove', moveHandlerRef.current);
        const handleMove = (e: L.LeafletMouseEvent) => emitSample(e.latlng);
        moveHandlerRef.current = handleMove;
        map.on('mousemove', handleMove);

        if (clickHandlerRef.current) map.off('click', clickHandlerRef.current);
        const handleClick = (e: L.LeafletMouseEvent) => {
          emitSample(e.latlng);
          onMapClickRef.current?.(e.latlng.lat, e.latlng.lng);
        };
        clickHandlerRef.current = handleClick;
        map.on('click', handleClick);

        onLoadingChangeRef.current?.(false);
      })
      .catch((err) => {
        console.error('[WashUPM25HeatMapLayer] Failed to load grid:', err);
        onLoadingChangeRef.current?.(false);
      });

    return () => {
      cancelled = true;
      onLoadingChangeRef.current?.(false);
      onPm25SampleRef.current?.(null);
      gridRef.current = null;
      if (moveHandlerRef.current) map.off('mousemove', moveHandlerRef.current);
      if (clickHandlerRef.current) map.off('click', clickHandlerRef.current);
      moveHandlerRef.current = null;
      clickHandlerRef.current = null;
      if (overlayRef.current) {
        map.removeLayer(overlayRef.current);
        overlayRef.current = null;
      }
    };
  }, [map, period, year, month, opacity]);

  return null;
};

export default WashUPM25HeatMapLayer;
