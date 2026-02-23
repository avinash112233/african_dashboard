/**
 * AOD Heat Map Layer – uses leaflet.heat to visualize AOD at AERONET sites
 * Intensity = AOD_500nm (or first available wavelength)
 */

import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet.heat';
import type { AERONETSite, SiteAODMap } from '../../services/aeronetApi';

// leaflet.heat adds L.heatLayer
const heatLayer = (L as typeof L & { heatLayer: (latlngs: [number, number, number][], options?: Record<string, unknown>) => L.Layer }).heatLayer;

interface AODHeatMapLayerProps {
  aeronetSites: AERONETSite[];
  siteAodMap: SiteAODMap;
}

/** Get AOD value for a site (prefer 500nm, fallback to other wavelengths) */
function getSiteAOD(site: AERONETSite, aodMap: SiteAODMap): number | null {
  const entry = aodMap[site.site] ?? aodMap[site.name ?? ''];
  if (!entry || !entry.hasData) return null;
  const v = entry.AOD_500nm ?? entry.AOD_675nm ?? entry.AOD_870nm ?? entry.AOD_1020nm;
  return v != null && !isNaN(v) ? v : null;
}

const AODHeatMapLayer = ({ aeronetSites, siteAodMap }: AODHeatMapLayerProps) => {
  const map = useMap();
  const layerRef = useRef<L.Layer | null>(null);

  useEffect(() => {
    if (!map || !heatLayer) return;

    const points: [number, number, number][] = [];
    for (const site of aeronetSites) {
      const aod = getSiteAOD(site, siteAodMap);
      if (aod != null && aod >= 0) {
        points.push([site.latitude, site.longitude, Math.min(aod, 2)]);
      }
    }

    if (points.length === 0) return;

    const maxAod = Math.max(...points.map((p) => p[2]), 0.5);
    const layer = heatLayer(points, {
      radius: 35,
      blur: 25,
      max: maxAod,
      minOpacity: 0.3,
      gradient: {
        0.0: '#16a34a',
        0.25: '#ca8a04',
        0.5: '#ea580c',
        0.75: '#dc2626',
        1.0: '#7f1d1d',
      },
    });

    layer.addTo(map);
    layerRef.current = layer;

    return () => {
      map.removeLayer(layer);
      layerRef.current = null;
    };
  }, [map, aeronetSites, siteAodMap]);

  return null;
};

export default AODHeatMapLayer;
