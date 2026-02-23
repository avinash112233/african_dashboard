/**
 * CircleSelectLayer – draw a selection circle on the map and handle center placement
 */

import { useEffect, useState } from 'react';
import { Circle, useMap, useMapEvents } from 'react-leaflet';

const CIRCLE_PANE = 'circleSelectPane';

interface CircleSelectLayerProps {
  center: [number, number] | null;
  radiusKm: number;
  onCenterChange: (lat: number, lng: number) => void;
  active: boolean;
}

export default function CircleSelectLayer({
  center,
  radiusKm,
  onCenterChange,
  active,
}: CircleSelectLayerProps) {
  const map = useMap();
  const [paneReady, setPaneReady] = useState(false);

  useEffect(() => {
    if (!map.getPane(CIRCLE_PANE)) {
      map.createPane(CIRCLE_PANE);
      const pane = map.getPane(CIRCLE_PANE);
      if (pane) pane.style.zIndex = '500';
    }
    setPaneReady(true);
  }, [map]);

  useMapEvents({
    click: (e) => {
      if (!active) return;
      onCenterChange(e.latlng.lat, e.latlng.lng);
    },
  });

  useEffect(() => {
    if (active) {
      map.getContainer().style.cursor = 'crosshair';
    } else {
      map.getContainer().style.cursor = '';
    }
    return () => {
      map.getContainer().style.cursor = '';
    };
  }, [active, map]);

  if (!center || radiusKm <= 0 || !paneReady) return null;

  const radiusM = radiusKm * 1000;

  return (
    <Circle
      center={center}
      radius={radiusM}
      pathOptions={{
        color: '#eab308',
        fillColor: '#facc15',
        fillOpacity: 0.35,
        weight: 2.5,
        dashArray: '5 5',
      }}
      pane={CIRCLE_PANE}
    />
  );
}
