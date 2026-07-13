/**
 * OpenAQ station markers — incremental canvas updates (positions once, recolor in place).
 */

import { useEffect, useRef, memo, type RefObject } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import type { OpenAqStationRecord } from '../../services/openaqApi';
import { hasOpenAqPm25Value } from '../../services/openaqApi';
import { calculateAQIFromPm25, getAqiCategory } from '../../utils/aqiUtils';

const MARKER_CHUNK = 400;

interface OpenAqStationsLayerProps {
  stations: OpenAqStationRecord[];
  onStationClick?: (station: OpenAqStationRecord) => void;
  active?: boolean;
}

function stationKey(s: OpenAqStationRecord): string {
  return `${s.sensorId}`;
}

function markerStyle(s: OpenAqStationRecord) {
  const hasValue = hasOpenAqPm25Value(s);
  const aqi = hasValue ? calculateAQIFromPm25(s.pm25!) : null;
  const aqiCategory = hasValue
    ? getAqiCategory(aqi)
    : { color: '#94a3b8', label: 'No data' };
  return { hasValue, aqi, aqiCategory };
}

function tooltipText(s: OpenAqStationRecord): string {
  const { hasValue, aqi, aqiCategory } = markerStyle(s);
  const modeLabel = s.mode === 'latest' ? 'latest reading' : 'daily mean';
  const valueLabel = hasValue ? `${s.pm25!.toFixed(1)} µg/m³` : 'no reading';
  return `${s.name}: ${hasValue ? `AQI ${aqi ?? '—'} (${aqiCategory.label}) · PM2.5 ${valueLabel}` : `${aqiCategory.label} · ${modeLabel}`}`;
}

function createStationMarker(
  s: OpenAqStationRecord,
  renderer: L.Canvas,
  onClickRef: RefObject<((station: OpenAqStationRecord) => void) | undefined>
): L.CircleMarker {
  const { hasValue, aqiCategory } = markerStyle(s);

  const marker = L.circleMarker([s.latitude, s.longitude], {
    radius: 7,
    fillColor: aqiCategory.color,
    color: '#334155',
    weight: 1,
    opacity: 1,
    fillOpacity: hasValue ? 0.92 : 0.45,
    renderer,
    interactive: true,
    bubblingMouseEvents: true,
    className: 'openaq-station-marker',
  });

  marker.on('click', (e) => {
    L.DomEvent.stopPropagation(e);
    onClickRef.current?.(s);
  });

  marker.bindTooltip(tooltipText(s), {
    direction: 'top',
    offset: [0, -6],
    className: 'openaq-station-tooltip',
  });

  return marker;
}

function updateStationMarker(marker: L.CircleMarker, s: OpenAqStationRecord): void {
  const { hasValue, aqiCategory } = markerStyle(s);
  marker.setStyle({
    fillColor: aqiCategory.color,
    color: '#334155',
    fillOpacity: hasValue ? 0.92 : 0.45,
  });
  marker.getTooltip()?.setContent(tooltipText(s));
}

const OpenAqStationsLayer = memo(function OpenAqStationsLayer({
  stations,
  onStationClick,
  active = true,
}: OpenAqStationsLayerProps) {
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

      if (index < toAdd.length) {
        requestAnimationFrame(addChunk);
      } else {
        for (const s of stations) {
          const key = stationKey(s);
          const existing = markersRef.current.get(key);
          if (existing) updateStationMarker(existing, s);
        }
      }
    };

    if (toAdd.length > 0) {
      addChunk();
    } else {
      for (const s of stations) {
        const key = stationKey(s);
        const existing = markersRef.current.get(key);
        if (existing) updateStationMarker(existing, s);
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

export default OpenAqStationsLayer;
