/**
 * FireChartRectangleLayer — click-drag axis-aligned rectangle for chart spatial filtering.
 * Disables map pan while dragging so the box draws reliably.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Rectangle, useMap, useMapEvents } from 'react-leaflet';
import type { LatLonBounds } from '../../utils/geoUtils';
import { normalizeLatLonBounds } from '../../utils/geoUtils';

const RECT_PANE = 'fireChartRectPane';

const MIN_SPAN_DEG = 0.05;

interface FireChartRectangleLayerProps {
  drawActive: boolean;
  committedBounds: LatLonBounds | null;
  onCommit: (bounds: LatLonBounds) => void;
}

export default function FireChartRectangleLayer({
  drawActive,
  committedBounds,
  onCommit,
}: FireChartRectangleLayerProps) {
  const map = useMap();
  const [paneReady, setPaneReady] = useState(false);
  const [previewBounds, setPreviewBounds] = useState<LatLonBounds | null>(null);
  const dragRef = useRef<{ startLat: number; startLng: number; dragging: boolean } | null>(null);

  useEffect(() => {
    if (!map.getPane(RECT_PANE)) {
      map.createPane(RECT_PANE);
      const pane = map.getPane(RECT_PANE);
      if (pane) pane.style.zIndex = '480';
    }
    setPaneReady(true);
  }, [map]);

  const endDrag = useCallback(() => {
    dragRef.current = null;
    setPreviewBounds(null);
    if (map.dragging.enabled() === false) {
      map.dragging.enable();
    }
  }, [map]);

  useEffect(() => {
    if (!drawActive) {
      endDrag();
      map.getContainer().style.cursor = '';
      return;
    }
    map.getContainer().style.cursor = 'crosshair';
    return () => {
      map.getContainer().style.cursor = '';
    };
  }, [drawActive, map, endDrag]);

  const finishDrag = useCallback(
    (endLat: number, endLng: number) => {
      const d = dragRef.current;
      if (!d?.dragging) {
        endDrag();
        return;
      }
      const b = normalizeLatLonBounds(d.startLat, d.startLng, endLat, endLng);
      endDrag();
      const latSpan = b.north - b.south;
      const lngSpan = b.east - b.west;
      if (latSpan < MIN_SPAN_DEG || lngSpan < MIN_SPAN_DEG) return;
      onCommit(b);
    },
    [endDrag, onCommit]
  );

  const removeWindowListeners = useRef<(() => void) | null>(null);

  useMapEvents({
    mousedown: (e) => {
      if (!drawActive) return;
      const oe = e.originalEvent as MouseEvent | undefined;
      if (oe?.button !== 0) return;
      oe?.preventDefault();
      removeWindowListeners.current?.();
      map.dragging.disable();
      const { lat, lng } = e.latlng;
      dragRef.current = { startLat: lat, startLng: lng, dragging: true };
      setPreviewBounds(normalizeLatLonBounds(lat, lng, lat, lng));

      const onMove = (ev: MouseEvent) => {
        const d = dragRef.current;
        if (!d?.dragging) return;
        const p = map.mouseEventToLatLng(ev);
        setPreviewBounds(normalizeLatLonBounds(d.startLat, d.startLng, p.lat, p.lng));
      };

      const onUp = (ev: MouseEvent) => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        removeWindowListeners.current = null;
        if (!dragRef.current?.dragging) {
          endDrag();
          return;
        }
        const p = map.mouseEventToLatLng(ev);
        finishDrag(p.lat, p.lng);
      };

      removeWindowListeners.current = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        removeWindowListeners.current = null;
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
  });

  useEffect(() => {
    return () => {
      removeWindowListeners.current?.();
      endDrag();
    };
  }, [endDrag]);

  if (!paneReady) return null;

  const rectPath = {
    color: '#2563eb',
    weight: 2,
    fillColor: '#3b82f6',
    fillOpacity: 0.12,
    dashArray: '6 4' as const,
  };

  const committedPath = {
    color: '#1d4ed8',
    weight: 2.5,
    fillColor: '#3b82f6',
    fillOpacity: 0.18,
  };

  const toLeafletBounds = (b: LatLonBounds) =>
    [
      [b.south, b.west],
      [b.north, b.east],
    ] as [[number, number], [number, number]];

  return (
    <>
      {committedBounds && (
        <Rectangle bounds={toLeafletBounds(committedBounds)} pathOptions={committedPath} pane={RECT_PANE} />
      )}
      {previewBounds && drawActive && (
        <Rectangle bounds={toLeafletBounds(previewBounds)} pathOptions={rectPath} pane={RECT_PANE} />
      )}
    </>
  );
}
