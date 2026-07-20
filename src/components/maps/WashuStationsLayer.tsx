/**
 * WashU ACAG station markers — chunked rendering (same pattern as MERRA2 stations).
 */

import { useEffect, useRef, memo, type RefObject } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import type { WashUStationDailyRecord } from '../../services/washuApi';
import { calculateAQIFromPm25, getAqiCategory } from '../../utils/aqiUtils';

const MARKER_CHUNK = 120;

interface WashuStationsLayerProps {
  stations: WashUStationDailyRecord[];
  onStationClick?: (station: WashUStationDailyRecord) => void;
  active?: boolean;
}

function stationKey(s: WashUStationDailyRecord): string {
  return `${s.sitename}|${s.latitude}|${s.longitude}`;
}

function createStationMarker(
  s: WashUStationDailyRecord,
  renderer: L.Canvas,
  onClickRef: RefObject<((station: WashUStationDailyRecord) => void) | undefined>
): L.CircleMarker {
  const aqi = calculateAQIFromPm25(s.pm25);
  const aqiCategory = getAqiCategory(aqi);

  const marker = L.circleMarker([s.latitude, s.longitude], {
    radius: 7,
    fillColor: aqiCategory.color,
    color: '#5b21b6',
    weight: 1.5,
    opacity: 1,
    fillOpacity: 0.92,
    renderer,
    interactive: true,
    bubblingMouseEvents: true,
    className: 'washu-station-marker',
  });

  marker.on('click', (e) => {
    L.DomEvent.stopPropagation(e);
    onClickRef.current?.(s);
  });

  marker.bindTooltip(
    `${s.sitename}: AQI ${aqi ?? '—'} (${aqiCategory.label}) · WashU PM2.5 ${s.pm25.toFixed(2)} µg/m³`,
    { direction: 'top', offset: [0, -6], className: 'washu-station-tooltip' }
  );

  return marker;
}

const WashuStationsLayer = memo(function WashuStationsLayer({
  stations,
  onStationClick,
  active = true,
}: WashuStationsLayerProps) {
  const map = useMap();
  const groupRef = useRef<L.LayerGroup | null>(null);
  const rendererRef = useRef<L.Canvas | null>(null);
  const markersRef = useRef<Map<string, L.CircleMarker>>(new Map());
  const buildGenRef = useRef(0);
  const onClickRef = useRef(onStationClick);

  useEffect(() => {
    onClickRef.current = onStationClick;
  }, [onStationClick]);

  useEffect(() => {
    if (!map || !active) {
      buildGenRef.current += 1;
      markersRef.current.forEach((m) => m.remove());
      markersRef.current.clear();
      if (groupRef.current) {
        map?.removeLayer(groupRef.current);
        groupRef.current = null;
      }
      return;
    }

    const gen = ++buildGenRef.current;
    const renderer = rendererRef.current ?? L.canvas({ padding: 0.5 });
    rendererRef.current = renderer;

    if (!groupRef.current) {
      const group = L.layerGroup();
      group.addTo(map);
      groupRef.current = group;
    }

    const group = groupRef.current;
    const nextKeys = new Set(stations.map(stationKey));

    for (const [key, marker] of markersRef.current) {
      if (!nextKeys.has(key)) {
        group.removeLayer(marker);
        markersRef.current.delete(key);
      }
    }

    const toAdd = stations.filter((s) => {
      if (!Number.isFinite(s.latitude) || !Number.isFinite(s.longitude)) return false;
      return !markersRef.current.has(stationKey(s));
    });

    let index = 0;

    const addChunk = () => {
      if (buildGenRef.current !== gen || !groupRef.current) return;

      const end = Math.min(index + MARKER_CHUNK, toAdd.length);
      for (; index < end; index++) {
        const s = toAdd[index];
        const key = stationKey(s);
        const marker = createStationMarker(s, renderer, onClickRef);
        marker.addTo(group);
        markersRef.current.set(key, marker);
      }

      if (index < toAdd.length) requestAnimationFrame(addChunk);
    };

    if (toAdd.length > 0) {
      addChunk();
    } else if (stations.length > 0) {
      for (const s of stations) {
        const key = stationKey(s);
        const existing = markersRef.current.get(key);
        if (!existing) continue;
        const aqi = calculateAQIFromPm25(s.pm25);
        const aqiCategory = getAqiCategory(aqi);
        existing.setStyle({ fillColor: aqiCategory.color, color: '#5b21b6' });
      }
    }

    return () => {
      buildGenRef.current += 1;
    };
  }, [map, active, stations]);

  useEffect(() => {
    return () => {
      buildGenRef.current += 1;
      markersRef.current.forEach((m) => m.remove());
      markersRef.current.clear();
      if (groupRef.current && map) {
        map.removeLayer(groupRef.current);
        groupRef.current = null;
      }
    };
  }, [map]);

  return null;
});

export default WashuStationsLayer;
