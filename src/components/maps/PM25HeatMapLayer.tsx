/**
 * MERRA2 PM2.5 – native grid ImageOverlay with hourly timesteps.
 * Loads daily cube once (IndexedDB cache + optional NetCDF background download).
 */

import { useEffect, useRef, type MutableRefObject } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { hourGridFromCube, loadMerra2DailyCube, type Merra2DailyCube } from '../../services/merra2GridCube';
import { renderPm25GridAqiCells, renderPm25GridNativeCells, samplePm25AtLatLonNearest } from '../../utils/pm25Colormap';
import './PM25HeatMapLayer.css';

export interface PM25Sample {
  lat: number;
  lon: number;
  value: number;
  date: string;
  hour: number;
  min: number;
  max: number;
  units: string;
  source: 'gesdisc' | 'sample';
}

export type Merra2GridSampler = (lat: number, lon: number) => PM25Sample | null;

interface PM25HeatMapLayerProps {
  date: string;
  hour?: number;
  opacity?: number;
  /** Dashboard 2 uses EPA AQI category colors; Dashboard 1 keeps the continuous PM2.5 ramp. */
  colorMode?: 'continuous' | 'aqi';
  onPm25Sample?: (sample: PM25Sample | null) => void;
  onGridSamplerChange?: (sampler: Merra2GridSampler | null) => void;
  onLoadingChange?: (loading: boolean) => void;
  onSourceChange?: (source: 'gesdisc' | 'sample', fallbackReason?: string) => void;
}

function buildGridSampler(
  grid: ReturnType<typeof hourGridFromCube> | null
): Merra2GridSampler | null {
  if (!grid) return null;
  return (lat: number, lon: number) => {
    const value = samplePm25AtLatLonNearest(grid, lat, lon);
    if (value == null) return null;
    return {
      lat,
      lon,
      value,
      date: grid.date,
      hour: grid.hour,
      min: grid.min,
      max: grid.max,
      units: grid.units,
      source: grid.source,
    };
  };
}

function emitGridSampler(
  grid: ReturnType<typeof hourGridFromCube> | null,
  onGridSamplerChange?: (sampler: Merra2GridSampler | null) => void
) {
  onGridSamplerChange?.(buildGridSampler(grid));
}

function applyHourToMap(
  map: L.Map,
  cube: Merra2DailyCube,
  hour: number,
  opacity: number,
  colorMode: 'continuous' | 'aqi',
  overlayRef: MutableRefObject<L.ImageOverlay | null>
) {
  const grid = hourGridFromCube(cube, hour);
  const dataUrl =
    colorMode === 'aqi' ? renderPm25GridAqiCells(grid) : renderPm25GridNativeCells(grid);
  if (!dataUrl) return null;

  const { south, west, north, east } = grid.bounds;
  const bounds = L.latLngBounds([south, west], [north, east]);

  if (overlayRef.current) {
    map.removeLayer(overlayRef.current);
    overlayRef.current = null;
  }

  const overlay = L.imageOverlay(dataUrl, bounds, {
    opacity,
    pane: 'overlayPane',
    className: 'pm25-image-overlay pm25-image-overlay--native',
    interactive: false,
  });
  overlay.addTo(map);
  overlayRef.current = overlay;
  return grid;
}

const PM25HeatMapLayer = ({
  date,
  hour = 12,
  opacity = 0.65,
  colorMode = 'continuous',
  onPm25Sample,
  onGridSamplerChange,
  onLoadingChange,
  onSourceChange,
}: PM25HeatMapLayerProps) => {
  const map = useMap();
  const overlayRef = useRef<L.ImageOverlay | null>(null);
  const cubeRef = useRef<Merra2DailyCube | null>(null);
  const gridRef = useRef<ReturnType<typeof hourGridFromCube> | null>(null);
  const moveHandlerRef = useRef<((e: L.LeafletMouseEvent) => void) | null>(null);
  const onPm25SampleRef = useRef(onPm25Sample);
  const onGridSamplerChangeRef = useRef(onGridSamplerChange);
  const onLoadingChangeRef = useRef(onLoadingChange);
  const onSourceChangeRef = useRef(onSourceChange);
  onPm25SampleRef.current = onPm25Sample;
  onGridSamplerChangeRef.current = onGridSamplerChange;
  onLoadingChangeRef.current = onLoadingChange;
  onSourceChangeRef.current = onSourceChange;

  useEffect(() => {
    if (!map) return;

    let cancelled = false;
    onLoadingChangeRef.current?.(true);

    loadMerra2DailyCube(date)
      .then((cube) => {
        if (cancelled || !map) return;
        cubeRef.current = cube;
        onSourceChangeRef.current?.(cube.source, cube.fallbackReason);
        gridRef.current = applyHourToMap(map, cube, hour, opacity, colorMode, overlayRef) ?? null;
        emitGridSampler(gridRef.current, onGridSamplerChangeRef.current);

        const emitSample = (latlng: L.LatLng) => {
          const g = gridRef.current;
          if (!g) return;
          const value = samplePm25AtLatLonNearest(g, latlng.lat, latlng.lng);
          if (value == null) {
            onPm25SampleRef.current?.(null);
            return;
          }
          onPm25SampleRef.current?.({
            lat: latlng.lat,
            lon: latlng.lng,
            value,
            date: g.date,
            hour: g.hour,
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
        onLoadingChangeRef.current?.(false);
      })
      .catch((err) => {
        console.error('[PM25HeatMapLayer] Failed to load daily cube:', err);
        onLoadingChangeRef.current?.(false);
      });

    return () => {
      cancelled = true;
      onLoadingChangeRef.current?.(false);
      onPm25SampleRef.current?.(null);
      onGridSamplerChangeRef.current?.(null);
      cubeRef.current = null;
      gridRef.current = null;
      if (moveHandlerRef.current) map.off('mousemove', moveHandlerRef.current);
      moveHandlerRef.current = null;
      if (overlayRef.current) {
        map.removeLayer(overlayRef.current);
        overlayRef.current = null;
      }
    };
  }, [map, date, opacity, colorMode]);

  useEffect(() => {
    if (!map || !cubeRef.current) return;
    gridRef.current = applyHourToMap(map, cubeRef.current, hour, opacity, colorMode, overlayRef) ?? null;
    emitGridSampler(gridRef.current, onGridSamplerChangeRef.current);
  }, [map, hour, opacity, colorMode]);

  return null;
};

export default PM25HeatMapLayer;
