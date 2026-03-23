/**
 * Canvas Fire Layer – AERONET and fire hotspot markers using Leaflet canvas rendering.
 * Uses a single LayerGroup and L.circleMarker with a shared L.canvas() renderer so
 * markers stay perfectly synced with the map during zoom/pan and are not re-created on zoom.
 */

import { useEffect, useRef, memo } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import type { FIRMSFirePoint } from '../../services/firmsApi';
import type { AERONETSite, SiteAODMap } from '../../services/aeronetApi';
import { getAODLevelColor, getAODLevelLabel } from '../../utils/aodUtils';

const MAX_FIRE_MARKERS = 80000;

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

interface CanvasFireLayerProps {
  firePoints: FIRMSFirePoint[];
  onFireClick?: (fire: FIRMSFirePoint) => void;
  aeronetSites?: AERONETSite[];
  siteAodMap?: SiteAODMap;
  onAeronetSiteClick?: (site: AERONETSite) => void;
  allowPointerEvents?: boolean;
}

const CanvasFireLayer = memo(function CanvasFireLayer({
  firePoints,
  onFireClick,
  aeronetSites = [],
  siteAodMap = {},
  onAeronetSiteClick,
  allowPointerEvents = true,
}: CanvasFireLayerProps) {
  const map = useMap();
  const groupRef = useRef<L.LayerGroup | null>(null);
  const onFireClickRef = useRef<typeof onFireClick>(onFireClick);
  const onAeronetSiteClickRef = useRef<typeof onAeronetSiteClick>(onAeronetSiteClick);

  // Keep callback refs up-to-date without forcing marker layer rebuilds.
  useEffect(() => {
    onFireClickRef.current = onFireClick;
  }, [onFireClick]);

  useEffect(() => {
    onAeronetSiteClickRef.current = onAeronetSiteClick;
  }, [onAeronetSiteClick]);

  useEffect(() => {
    if (!map) return;

    const sharedRenderer = L.canvas();
    const group = (groupRef.current = L.layerGroup());

    const aodMap = siteAodMap ?? {};
    const sitesToShow = aeronetSites ?? [];
    const firesToShow = sampleFirePoints(firePoints, MAX_FIRE_MARKERS);

    for (const site of sitesToShow) {
      const aod = aodMap[site.site] ?? aodMap[site.name ?? ''];
      const hasData = aod?.hasData === true;
      const latestAod =
        hasData && aod
          ? (aod.AOD_500nm ?? aod.AOD_675nm ?? aod.AOD_870nm ?? aod.AOD_1020nm)
          : undefined;
      let fillColor: string;
      let strokeColor: string;
      let tooltipText: string;
      if (!hasData || latestAod == null) {
        // Slightly darker gray fill, but no visible stroke
        fillColor = 'rgba(80, 80, 80, 0.9)';
        strokeColor = 'rgba(0, 0, 0, 0)';
        tooltipText = 'No data available';
      } else {
        // Use AOD color as fill, no visible stroke
        fillColor = getAODLevelColor(latestAod);
        strokeColor = 'rgba(0, 0, 0, 0)';
        const label = getAODLevelLabel(latestAod);
        tooltipText = label
          ? `${site.name ?? site.site}: ${label} (AOD ${latestAod.toFixed(3)})`
          : `${site.name ?? site.site}: AOD ${latestAod.toFixed(3)}`;
      }

      const marker = L.circleMarker([site.latitude, site.longitude], {
        radius: 10,
        fillColor,
        color: strokeColor,
        weight: 0,
        opacity: 1,
        fillOpacity: 0.9,
        renderer: sharedRenderer,
        interactive: allowPointerEvents,
      });
      if (allowPointerEvents) {
        marker.bindTooltip(tooltipText, {
          permanent: false,
          direction: 'top',
          className: 'canvas-fire-layer-tooltip',
        });
        marker.on('click', () => {
          onAeronetSiteClickRef.current?.(site);
        });
      }
      marker.addTo(group);
    }

    for (const fire of firesToShow) {
      const marker = L.circleMarker([fire.latitude, fire.longitude], {
        radius: 3,
        fillColor: '#ff0000',
        color: 'rgba(255, 255, 255, 0.9)',
        weight: 1,
        opacity: 1,
        fillOpacity: 1,
        renderer: sharedRenderer,
        interactive: allowPointerEvents,
      });
      if (allowPointerEvents) {
        marker.bindTooltip(
          `Fire: ${fire.acq_date} ${fire.acq_time ?? ''} (${fire.latitude.toFixed(4)}, ${fire.longitude.toFixed(4)})`,
          { permanent: false, direction: 'top', className: 'canvas-fire-layer-tooltip' }
        );
        marker.on('click', () => {
          onFireClickRef.current?.(fire);
        });
      }
      marker.addTo(group);
    }

    group.addTo(map);

    return () => {
      map.removeLayer(group);
      groupRef.current = null;
    };
  }, [
    map,
    firePoints,
    aeronetSites,
    siteAodMap,
    allowPointerEvents,
  ]);

  return null;
});

export default CanvasFireLayer;
