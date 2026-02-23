/**
 * PM25HeatMapLayer – canvas overlay for MERRA2 PM2.5 grid
 * Renders fast via ImageOverlay and supports click/hover value sampling.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { getMERRA2PM25Grid, type MERRA2PM25GridResponse } from '../../services/merra2Api';

/** PM2.5 color gradient: green → yellow → orange → red */
const PM25_GRADIENT: Record<number, string> = {
  0.0: '#16a34a',
  0.2: '#84cc16',
  0.4: '#eab308',
  0.6: '#f97316',
  0.8: '#dc2626',
  1.0: '#7f1d1d',
};

function valueToColor(value: number, min: number, max: number, noDataValue: number): string {
  if (value === noDataValue || value == null || isNaN(value)) return 'rgba(0,0,0,0)';
  if (min >= max) return '#94a3b8';
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
  let lowKey = 0;
  let highKey = 1;
  for (const k of Object.keys(PM25_GRADIENT).map(Number).sort((a, b) => a - b)) {
    if (k <= t) lowKey = k;
    if (k >= t) {
      highKey = k;
      break;
    }
  }
  if (lowKey === highKey) return PM25_GRADIENT[lowKey];
  const s = (t - lowKey) / (highKey - lowKey);
  const c1 = PM25_GRADIENT[lowKey];
  const c2 = PM25_GRADIENT[highKey];
  const hex = (x: string) => parseInt(x, 16);
  const r = Math.round(hex(c1.slice(1, 3)) * (1 - s) + hex(c2.slice(1, 3)) * s);
  const g = Math.round(hex(c1.slice(3, 5)) * (1 - s) + hex(c2.slice(3, 5)) * s);
  const b = Math.round(hex(c1.slice(5, 7)) * (1 - s) + hex(c2.slice(5, 7)) * s);
  return `rgb(${r},${g},${b})`;
}

function renderGridToCanvas(
  grid: MERRA2PM25GridResponse,
  canvas: HTMLCanvasElement,
  opacity: number
) {
  const { width, height, values, min, max, noDataValue } = grid;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  canvas.width = width;
  canvas.height = height;
  const imgData = ctx.createImageData(width, height);

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const col = valueToColor(v, min, max, noDataValue);
    const base = i * 4;
    if (col === 'rgba(0,0,0,0)') {
      imgData.data[base] = 0;
      imgData.data[base + 1] = 0;
      imgData.data[base + 2] = 0;
      imgData.data[base + 3] = 0;
    } else {
      const m = col.match(/rgb\((\d+),(\d+),(\d+)\)/);
      if (m) {
        imgData.data[base] = parseInt(m[1], 10);
        imgData.data[base + 1] = parseInt(m[2], 10);
        imgData.data[base + 2] = parseInt(m[3], 10);
        imgData.data[base + 3] = Math.round(opacity * 255);
      }
    }
  }
  ctx.putImageData(imgData, 0, 0);
}

function latLonToIndex(
  lat: number,
  lon: number,
  grid: MERRA2PM25GridResponse
): number | null {
  const { bounds, width, height } = grid;
  if (lat < bounds.south || lat > bounds.north || lon < bounds.west || lon > bounds.east) return null;
  const row = Math.floor(((bounds.north - lat) / (bounds.north - bounds.south)) * (height - 1));
  const col = Math.floor(((lon - bounds.west) / (bounds.east - bounds.west)) * (width - 1));
  const idx = Math.max(0, Math.min(row * width + col, grid.values.length - 1));
  return idx;
}

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
  onSourceChange?: (source: 'gesdisc' | 'sample') => void;
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
  const onPm25SampleRef = useRef(onPm25Sample);
  onPm25SampleRef.current = onPm25Sample;
  const onLoadingChangeRef = useRef(onLoadingChange);
  onLoadingChangeRef.current = onLoadingChange;
  const onSourceChangeRef = useRef(onSourceChange);
  onSourceChangeRef.current = onSourceChange;

  const handleMapEvent = useCallback((e: L.LeafletMouseEvent) => {
    const grid = gridRef.current;
    const cb = onPm25SampleRef.current;
    if (!grid || !cb) return;

    const idx = latLonToIndex(e.latlng.lat, e.latlng.lng, grid);
    if (idx == null) {
      cb(null);
      return;
    }
    const v = grid.values[idx];
    if (v === grid.noDataValue || v == null || isNaN(v)) {
      cb(null);
      return;
    }
    cb({
      lat: e.latlng.lat,
      lon: e.latlng.lng,
      value: v,
      date: grid.date,
      min: grid.min,
      max: grid.max,
      units: grid.units,
      source: grid.source,
    });
  }, []);

  useEffect(() => {
    if (!map) return;

    let cancelled = false;
    onLoadingChangeRef.current?.(true);

    getMERRA2PM25Grid(date)
      .then((grid) => {
        if (cancelled || !map) return;
        gridRef.current = grid;
        onSourceChangeRef.current?.(grid.source);

        const canvas = document.createElement('canvas');
        renderGridToCanvas(grid, canvas, opacity);

        const bounds: L.LatLngBoundsExpression = [
          [grid.bounds.south, grid.bounds.west],
          [grid.bounds.north, grid.bounds.east],
        ];
        const dataUrl = canvas.toDataURL('image/png');
        const overlay = L.imageOverlay(dataUrl, bounds, {
          opacity: 1,
          interactive: true,
          pane: 'overlayPane',
          zIndex: 340,
        });
        overlay.addTo(map);
        overlayRef.current = overlay;

        overlay.on('click', handleMapEvent);
        overlay.on('mousemove', handleMapEvent);
        overlay.on('mouseout', () => onPm25SampleRef.current?.(null));

        onLoadingChangeRef.current?.(false);
      })
      .catch((err) => {
        console.error('[PM25HeatMapLayer] Failed to load grid:', err);
        onLoadingChangeRef.current?.(false);
      });

    return () => {
      cancelled = true;
      onLoadingChangeRef.current?.(false);
      const ov = overlayRef.current;
      if (ov) {
        ov.off('click', handleMapEvent);
        ov.off('mousemove', handleMapEvent);
        ov.off('mouseout');
      }
      if (overlayRef.current) {
        map.removeLayer(overlayRef.current);
        overlayRef.current = null;
      }
      gridRef.current = null;
    };
  }, [map, date, opacity, handleMapEvent]);

  return null;
};

export default PM25HeatMapLayer;
