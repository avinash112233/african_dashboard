/**
 * MERRA2 PM2.5 – native grid ImageOverlay with hourly timesteps.
 * Loads daily cube once (IndexedDB cache + optional NetCDF background download).
 */

import { useEffect, useRef, type MutableRefObject } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { hourGridFromCube, loadMerra2DailyCube, type Merra2DailyCube } from '../../services/merra2GridCube';
import { renderPm25GridLightSmooth, samplePm25AtLatLonNearest } from '../../utils/pm25Colormap';
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

interface PM25HeatMapLayerProps {
  date: string;
  hour?: number;
  opacity?: number;
  onPm25Sample?: (sample: PM25Sample | null) => void;
  onLoadingChange?: (loading: boolean) => void;
  onSourceChange?: (source: 'gesdisc' | 'sample', fallbackReason?: string) => void;
}

function applyHourToMap(
  map: L.Map,
  cube: Merra2DailyCube,
  hour: number,
  opacity: number,
  overlayRef: MutableRefObject<L.ImageOverlay | null>
) {
  const grid = hourGridFromCube(cube, hour);
  // Light bilinear upsample — softens blocky cells without WashU-level blur.
  const dataUrl = renderPm25GridLightSmooth(grid);
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
    className: 'pm25-image-overlay pm25-image-overlay--light-smooth',
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
  onPm25Sample,
  onLoadingChange,
  onSourceChange,
}: PM25HeatMapLayerProps) => {
  const map = useMap();
  const overlayRef = useRef<L.ImageOverlay | null>(null);
  const cubeRef = useRef<Merra2DailyCube | null>(null);
  const gridRef = useRef<ReturnType<typeof hourGridFromCube> | null>(null);
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

    loadMerra2DailyCube(date)
      .then((cube) => {
        if (cancelled || !map) return;
        cubeRef.current = cube;
        onSourceChangeRef.current?.(cube.source, cube.fallbackReason);
        gridRef.current = applyHourToMap(map, cube, hour, opacity, overlayRef) ?? null;

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
      cubeRef.current = null;
      gridRef.current = null;
      if (moveHandlerRef.current) map.off('mousemove', moveHandlerRef.current);
      moveHandlerRef.current = null;
      if (overlayRef.current) {
        map.removeLayer(overlayRef.current);
        overlayRef.current = null;
      }
    };
  }, [map, date, opacity]);

  useEffect(() => {
    if (!map || !cubeRef.current) return;
    gridRef.current = applyHourToMap(map, cubeRef.current, hour, opacity, overlayRef) ?? null;
  }, [map, hour, opacity]);

  return null;
};

export default PM25HeatMapLayer;
