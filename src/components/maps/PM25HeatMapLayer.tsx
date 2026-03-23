/**
 * PM25HeatMapLayer – point-based MERRA2 PM2.5 visualization
 * Converts the grid to sampled circle markers (like AERONET) for a lighter,
 * consistent visualization. Uses a LayerGroup and L.circleMarker with shared canvas renderer.
 */

import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { getMERRA2PM25Grid, type MERRA2PM25GridResponse } from '../../services/merra2Api';

const SAMPLE_STEP = 5;

/** PM2.5 color gradient: green (low) → yellow → orange → red (high) */
const PM25_GRADIENT: Record<number, string> = {
  0.0: '#16a34a',
  0.2: '#84cc16',
  0.4: '#eab308',
  0.6: '#f97316',
  0.8: '#dc2626',
  1.0: '#7f1d1d',
};

function valueToColor(value: number, min: number, max: number, noDataValue: number): string | null {
  if (value === noDataValue || value == null || isNaN(value)) return null;
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

interface SampledPoint {
  lat: number;
  lon: number;
  value: number;
}

/** Approx meters per degree at equator; used for geographic circle radius */
const METERS_PER_DEG_LAT = 111000;

/**
 * Convert grid to sampled points. Each point stores PM2.5 from values[row * width + col].
 * Cell (row, col) center: lat = north - (row + 0.5) * latStep, lon = west + (col + 0.5) * lonStep.
 * Samples every SAMPLE_STEP rows and columns; skips noDataValue.
 * Returns points and the radius in meters for consistent cell size at any zoom.
 */
function gridToSampledPoints(
  grid: MERRA2PM25GridResponse
): { points: SampledPoint[]; radiusM: number } {
  const { bounds, width, height, values, noDataValue } = grid;
  const { south, north, west, east } = bounds;
  const latStep = (north - south) / height;
  const lonStep = (east - west) / width;
  const points: SampledPoint[] = [];

  for (let row = 0; row < height; row += SAMPLE_STEP) {
    for (let col = 0; col < width; col += SAMPLE_STEP) {
      const idx = row * width + col;
      const pm25Value = values[idx];
      if (pm25Value === noDataValue || pm25Value == null || isNaN(pm25Value)) continue;

      const lat = north - (row + 0.5) * latStep;
      const lon = west + (col + 0.5) * lonStep;
      points.push({ lat, lon, value: pm25Value });
    }
  }
  const radiusM = (0.5 * Math.min(latStep, lonStep) * METERS_PER_DEG_LAT);
  return { points, radiusM };
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
  const groupRef = useRef<L.LayerGroup | null>(null);
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
        onSourceChangeRef.current?.(grid.source);

        const group = L.layerGroup();
        const { points, radiusM } = gridToSampledPoints(grid);
        const { min, max, noDataValue, date: gridDate, units, source } = grid;

        const notifySample = (s: PM25Sample | null) => {
          onPm25SampleRef.current?.(s);
        };

        for (const p of points) {
          const fillColor = valueToColor(p.value, min, max, noDataValue);
          if (fillColor == null) continue;

          const sample: PM25Sample = {
            lat: p.lat,
            lon: p.lon,
            value: p.value,
            date: gridDate,
            min,
            max,
            units,
            source,
          };

          const circle = L.circle([p.lat, p.lon], {
            radius: radiusM,
            fillColor,
            color: 'rgba(255,255,255,0.7)',
            weight: 1,
            opacity: 1,
            fillOpacity: opacity,
            renderer: L.svg(),
            interactive: true,
          });

          circle.bindTooltip(
            `PM2.5: ${p.value.toFixed(1)} ${units}`,
            { permanent: false, direction: 'top', className: 'pm25-marker-tooltip' }
          );

          circle.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            notifySample(sample);
          });
          circle.on('mouseover', () => notifySample(sample));
          circle.on('mouseout', () => notifySample(null));
          circle.addTo(group);
        }

        group.addTo(map);
        groupRef.current = group;
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
      if (groupRef.current) {
        map.removeLayer(groupRef.current);
        groupRef.current = null;
      }
    };
  }, [map, date, opacity]);

  return null;
};

export default PM25HeatMapLayer;
