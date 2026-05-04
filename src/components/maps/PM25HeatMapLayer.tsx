/**
 * MERRA2 PM2.5 – tile-based raster rendering.
 * Uses a custom Leaflet GridLayer to draw PM2.5 tiles dynamically from the grid,
 * avoiding rectangular image overlays and preserving smooth scientific gradients.
 */

import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { getMERRA2PM25Grid, type MERRA2PM25GridResponse } from '../../services/merra2Api';
import {
  PM25_COLORBAR_MAX,
  PM25_COLORBAR_MIN,
  pm25ToRgb,
  samplePm25AtLatLon,
} from '../../utils/pm25Colormap';
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

function createPm25GridLayer(
  map: L.Map,
  grid: MERRA2PM25GridResponse,
  opacity: number
): L.GridLayer {
  const layer = L.gridLayer({
    opacity,
    zIndex: 360,
    updateWhenIdle: true,
    updateWhenZooming: false,
    keepBuffer: 2,
    noWrap: false,
    bounds: L.latLngBounds([-90, -180], [90, 180]),
    className: 'pm25-gridlayer--smooth',
  });

  (layer as L.GridLayer & { createTile: (coords: L.Coords) => HTMLElement }).createTile = function (coords: L.Coords) {
      const size = this.getTileSize();
      const canvas = L.DomUtil.create('canvas', 'pm25-grid-tile') as HTMLCanvasElement;
      canvas.width = size.x;
      canvas.height = size.y;
      const ctx = canvas.getContext('2d');
      if (!ctx) return canvas;
      const img = ctx.createImageData(size.x, size.y);
      const pixels = img.data;

      for (let y = 0; y < size.y; y++) {
        for (let x = 0; x < size.x; x++) {
          const worldPoint = L.point(coords.x * size.x + x, coords.y * size.y + y);
          const latlng = map.unproject(worldPoint, coords.z);
          const value = samplePm25AtLatLon(grid, latlng.lat, latlng.lng);
          if (value == null) continue;
          const [r, g, b] = pm25ToRgb(value, PM25_COLORBAR_MIN, PM25_COLORBAR_MAX);
          const i = (y * size.x + x) * 4;
          pixels[i] = r;
          pixels[i + 1] = g;
          pixels[i + 2] = b;
          pixels[i + 3] = 255;
        }
      }

      ctx.putImageData(img, 0, 0);
      return canvas;
  };

  return layer;
}

const PM25HeatMapLayer = ({
  date,
  opacity = 0.62,
  onPm25Sample,
  onLoadingChange,
  onSourceChange,
}: PM25HeatMapLayerProps) => {
  const map = useMap();
  const layerRef = useRef<L.GridLayer | null>(null);
  const gridRef = useRef<MERRA2PM25GridResponse | null>(null);
  const moveHandlerRef = useRef<((e: L.LeafletMouseEvent) => void) | null>(null);
  const clickHandlerRef = useRef<((e: L.LeafletMouseEvent) => void) | null>(null);
  const outHandlerRef = useRef<(() => void) | null>(null);
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

        const layer = createPm25GridLayer(map, grid, opacity);
        layer.addTo(map);
        layerRef.current = layer;

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
        const handleClick = (e: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e);
          emitSample(e.latlng);
        };
        const handleOut = () => onPm25SampleRef.current?.(null);

        moveHandlerRef.current = handleMove;
        clickHandlerRef.current = handleClick;
        outHandlerRef.current = handleOut;
        map.on('mousemove', handleMove);
        map.on('click', handleClick);
        map.on('mouseout', handleOut);
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
      if (clickHandlerRef.current) map.off('click', clickHandlerRef.current);
      if (outHandlerRef.current) map.off('mouseout', outHandlerRef.current);
      moveHandlerRef.current = null;
      clickHandlerRef.current = null;
      outHandlerRef.current = null;
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [map, date, opacity]);

  return null;
};

export default PM25HeatMapLayer;
