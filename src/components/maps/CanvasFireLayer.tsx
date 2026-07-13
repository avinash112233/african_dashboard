/**
 * AERONET + VIIRS fire markers on a shared canvas renderer.
 * Fires: viewport filter + sampling, built off-map then shown in one step (no heatmap).
 */

import { useEffect, useRef, memo } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import type { FIRMSFirePoint } from '../../services/firmsApi';
import type { AERONETSite, SiteAODMap } from '../../services/aeronetApi';
import { getAODLevelColor } from '../../utils/aodUtils';

const MAX_FIRE_MARKERS = 20000;
const FIRE_MARKER_CHUNK = 600;

function sampleFirePoints(points: FIRMSFirePoint[], max: number): FIRMSFirePoint[] {
  if (points.length <= max) return points;
  const numBands = 80;
  const bands: FIRMSFirePoint[][] = Array.from({ length: numBands }, () => []);
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const lat = points[i].latitude;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  const latSpan = maxLat === -Infinity || minLat === Infinity ? 1 : maxLat - minLat;
  for (const p of points) {
    const bi = Math.min(numBands - 1, Math.floor(((p.latitude - minLat) / latSpan) * numBands));
    bands[bi].push(p);
  }
  const result: FIRMSFirePoint[] = [];
  const perBand = Math.floor(max / numBands);
  for (const band of bands) {
    if (band.length <= perBand) {
      for (let i = 0; i < band.length; i++) result.push(band[i]);
    } else {
      const step = band.length / perBand;
      for (let i = 0; i < perBand; i++) {
        result.push(band[Math.min(Math.floor(i * step), band.length - 1)]);
      }
    }
  }
  return result;
}

function pointsInBounds<T extends { latitude: number; longitude: number }>(
  items: T[],
  bounds: L.LatLngBounds,
  pad = 0.25
): T[] {
  const south = bounds.getSouth() - pad;
  const north = bounds.getNorth() + pad;
  const west = bounds.getWest() - pad;
  const east = bounds.getEast() + pad;
  return items.filter(
    (p) => p.latitude >= south && p.latitude <= north && p.longitude >= west && p.longitude <= east
  );
}

interface CanvasFireLayerProps {
  firePoints: FIRMSFirePoint[];
  onFireClick?: (fire: FIRMSFirePoint) => void;
  aeronetSites?: AERONETSite[];
  siteAodMap?: SiteAODMap;
  onAeronetSiteClick?: (site: AERONETSite) => void;
  allowPointerEvents?: boolean;
  showAeronet?: boolean;
  showFires?: boolean;
}

const CanvasFireLayer = memo(function CanvasFireLayer({
  firePoints,
  onFireClick,
  aeronetSites = [],
  siteAodMap = {},
  onAeronetSiteClick,
  allowPointerEvents = true,
  showAeronet = false,
  showFires = false,
}: CanvasFireLayerProps) {
  const map = useMap();
  const aeronetGroupRef = useRef<L.LayerGroup | null>(null);
  const fireGroupRef = useRef<L.LayerGroup | null>(null);
  const rendererRef = useRef<L.Canvas | null>(null);
  const onFireClickRef = useRef(onFireClick);
  const onAeronetSiteClickRef = useRef(onAeronetSiteClick);
  const fireBuildGenRef = useRef(0);

  useEffect(() => {
    onFireClickRef.current = onFireClick;
  }, [onFireClick]);

  useEffect(() => {
    onAeronetSiteClickRef.current = onAeronetSiteClick;
  }, [onAeronetSiteClick]);

  useEffect(() => {
    if (!map) return;
    if (!rendererRef.current) rendererRef.current = L.canvas({ padding: 0.5 });
  }, [map]);

  useEffect(() => {
    if (!map || !showAeronet) {
      if (aeronetGroupRef.current) {
        map.removeLayer(aeronetGroupRef.current);
        aeronetGroupRef.current = null;
      }
      return;
    }

    const renderer = rendererRef.current ?? L.canvas({ padding: 0.5 });
    rendererRef.current = renderer;

    if (aeronetGroupRef.current) {
      map.removeLayer(aeronetGroupRef.current);
      aeronetGroupRef.current = null;
    }

    const group = L.layerGroup();
    const aodMap = siteAodMap ?? {};

    for (const site of aeronetSites) {
      const aod = aodMap[site.site] ?? aodMap[site.name ?? ''];
      const hasData = aod?.hasData === true;
      const latestAod =
        hasData && aod
          ? (aod.AOD_500nm ?? aod.AOD_675nm ?? aod.AOD_870nm ?? aod.AOD_1020nm)
          : undefined;
      const fillColor =
        !hasData || latestAod == null ? 'rgba(80, 80, 80, 0.9)' : getAODLevelColor(latestAod);

      const marker = L.circleMarker([site.latitude, site.longitude], {
        radius: 8,
        fillColor,
        color: 'rgba(0, 0, 0, 0)',
        weight: 0,
        opacity: 1,
        fillOpacity: 0.9,
        renderer,
        interactive: allowPointerEvents,
      });
      if (allowPointerEvents) {
        marker.on('click', () => onAeronetSiteClickRef.current?.(site));
      }
      marker.addTo(group);
    }

    aeronetGroupRef.current = group;
    if (aeronetSites.length > 0) group.addTo(map);

    return () => {
      if (aeronetGroupRef.current) {
        map.removeLayer(aeronetGroupRef.current);
        aeronetGroupRef.current = null;
      }
    };
  }, [map, showAeronet, aeronetSites, siteAodMap, allowPointerEvents]);

  useEffect(() => {
    if (!map || !showFires) {
      if (fireGroupRef.current) {
        map.removeLayer(fireGroupRef.current);
        fireGroupRef.current = null;
      }
      return;
    }

    const gen = ++fireBuildGenRef.current;
    const renderer = rendererRef.current ?? L.canvas({ padding: 0.5 });
    rendererRef.current = renderer;

    const mountFires = () => {
      if (fireBuildGenRef.current !== gen) return;

      if (fireGroupRef.current) {
        map.removeLayer(fireGroupRef.current);
        fireGroupRef.current = null;
      }

      const bounds = map.getBounds();
      const visible = pointsInBounds(firePoints, bounds);
      const firesToShow = sampleFirePoints(visible, MAX_FIRE_MARKERS);
      const group = L.layerGroup();
      fireGroupRef.current = group;
      if (firesToShow.length > 0) group.addTo(map);

      let index = 0;
      const addChunk = () => {
        if (fireBuildGenRef.current !== gen) return;
        const end = Math.min(index + FIRE_MARKER_CHUNK, firesToShow.length);
        for (; index < end; index++) {
          const fire = firesToShow[index];
          const marker = L.circleMarker([fire.latitude, fire.longitude], {
            radius: 3,
            fillColor: '#ff0000',
            color: 'rgba(255, 255, 255, 0.9)',
            weight: 1,
            opacity: 1,
            fillOpacity: 1,
            renderer,
            interactive: allowPointerEvents,
          });
          if (allowPointerEvents) {
            marker.on('click', () => onFireClickRef.current?.(fire));
          }
          marker.addTo(group);
        }
        if (index < firesToShow.length) requestAnimationFrame(addChunk);
      };

      if (firesToShow.length > 0) addChunk();
    };

    let debounce: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(mountFires, 150);
    };

    mountFires();
    map.on('moveend', schedule);
    map.on('zoomend', schedule);

    return () => {
      fireBuildGenRef.current += 1;
      if (debounce) clearTimeout(debounce);
      map.off('moveend', schedule);
      map.off('zoomend', schedule);
      if (fireGroupRef.current) {
        map.removeLayer(fireGroupRef.current);
        fireGroupRef.current = null;
      }
    };
  }, [map, showFires, firePoints, allowPointerEvents]);

  return null;
});

export default CanvasFireLayer;
