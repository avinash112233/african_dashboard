/**
 * MERRA2 station markers — added in chunks so early dots are clickable while the rest load.
 */

import { useEffect, useRef, memo, type RefObject } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import type { MERRA2StationDailyRecord } from '../../services/merra2Api';
import { calculateAQIFromPm25, getAqiCategory } from '../../utils/aqiUtils';

const MARKER_CHUNK = 120;

interface Merra2StationsLayerProps {
  stations: MERRA2StationDailyRecord[];
  onStationClick?: (station: MERRA2StationDailyRecord) => void;
  active?: boolean;
}

function stationKey(s: MERRA2StationDailyRecord): string {
  return `${s.sitename}|${s.latitude}|${s.longitude}`;
}

function createStationMarker(
  s: MERRA2StationDailyRecord,
  renderer: L.Canvas,
  onClickRef: RefObject<((station: MERRA2StationDailyRecord) => void) | undefined>
): L.CircleMarker {
  const aqi = calculateAQIFromPm25(s.pm25);
  const aqiCategory = getAqiCategory(aqi);

  const marker = L.circleMarker([s.latitude, s.longitude], {
    radius: 7,
    fillColor: aqiCategory.color,
    color: '#334155',
    weight: 1,
    opacity: 1,
    fillOpacity: 0.92,
    renderer,
    interactive: true,
    bubblingMouseEvents: true,
    className: 'merra2-station-marker',
  });

  marker.on('click', (e) => {
    L.DomEvent.stopPropagation(e);
    onClickRef.current?.(s);
  });

  marker.bindTooltip(
    `${s.sitename}: AQI ${aqi ?? '—'} (${aqiCategory.label}) · PM2.5 ${s.pm25.toFixed(2)} µg/m³`,
    { direction: 'top', offset: [0, -6], className: 'merra2-station-tooltip' }
  );

  return marker;
}

const Merra2StationsLayer = memo(function Merra2StationsLayer({
  stations,
  onStationClick,
  active = true,
}: Merra2StationsLayerProps) {
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
        existing.setStyle({ fillColor: aqiCategory.color, color: '#334155' });
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

export default Merra2StationsLayer;
