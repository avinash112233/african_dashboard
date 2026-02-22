/**
 * Canvas Fire Layer – draws fire dots and AERONET markers efficiently
 * Uses layer coordinates so points stick to the map on zoom/pan
 */

import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import type { FIRMSFirePoint } from '../../services/firmsApi';
import type { AERONETSite, SiteAODMap } from '../../services/aeronetApi';
import { getAODLevelColor, getAODLevelLabel } from '../../utils/aodUtils';

interface CanvasFireLayerProps {
  firePoints: FIRMSFirePoint[];
  onFireClick?: (fire: FIRMSFirePoint) => void;
  aeronetSites?: AERONETSite[];
  siteAodMap?: SiteAODMap;
  onAeronetSiteClick?: (site: AERONETSite) => void;
  allowPointerEvents?: boolean;
}

const CanvasFireLayer = ({
  firePoints,
  onFireClick,
  aeronetSites = [],
  siteAodMap = {},
  onAeronetSiteClick,
  allowPointerEvents = true,
}: CanvasFireLayerProps) => {
  const map = useMap();
  const layerRef = useRef<L.Layer | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const firePointsRef = useRef<FIRMSFirePoint[]>(firePoints);
  const aeronetSitesRef = useRef<AERONETSite[]>(aeronetSites);
  const onFireClickRef = useRef(onFireClick);
  const onAeronetSiteClickRef = useRef(onAeronetSiteClick);

  useEffect(() => { firePointsRef.current = firePoints; }, [firePoints]);
  useEffect(() => { aeronetSitesRef.current = aeronetSites; }, [aeronetSites]);
  const siteAodMapRef = useRef<SiteAODMap>(siteAodMap);
  useEffect(() => { siteAodMapRef.current = siteAodMap; }, [siteAodMap]);
  useEffect(() => { onFireClickRef.current = onFireClick; }, [onFireClick]);
  useEffect(() => { onAeronetSiteClickRef.current = onAeronetSiteClick; }, [onAeronetSiteClick]);

  useEffect(() => {
    if (!map || (firePoints.length === 0 && aeronetSites.length === 0)) return;

    const canvas = document.createElement('canvas');
    canvas.style.position = 'absolute';
    canvas.style.pointerEvents = allowPointerEvents ? 'auto' : 'none';
    canvas.style.cursor = allowPointerEvents ? 'pointer' : 'default';
    canvas.style.zIndex = '450';
    canvasRef.current = canvas;

    const _redraw = () => {
      if (!canvas || !map) return;

      const bounds = map.getBounds();
      const size = map.getSize();
      if (canvas.width !== size.x || canvas.height !== size.y) {
        canvas.width = size.x;
        canvas.height = size.y;
      }
      canvas.style.width = size.x + 'px';
      canvas.style.height = size.y + 'px';

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const minLat = bounds.getSouth();
      const maxLat = bounds.getNorth();
      const minLng = bounds.getWest();
      const maxLng = bounds.getEast();

      const drawnAeronet: { site: AERONETSite; x: number; y: number; tooltip: string }[] = [];
      const aodMap = siteAodMapRef.current;
      if (aeronetSitesRef.current.length > 0) {
        ctx.lineWidth = 2;
        for (const site of aeronetSitesRef.current) {
          if (site.latitude >= minLat && site.latitude <= maxLat && site.longitude >= minLng && site.longitude <= maxLng) {
            const aod = aodMap[site.site] ?? aodMap[site.name ?? ''];
            const hasData = aod?.hasData === true;
            const latestAod = hasData && aod && aod.hasData
              ? (aod.AOD_500nm ?? aod.AOD_675nm ?? aod.AOD_870nm ?? aod.AOD_1020nm)
              : undefined;
            let fillColor: string;
            let strokeColor: string;
            let tooltip: string;
            if (!hasData || latestAod == null) {
              fillColor = 'rgba(128, 128, 128, 0.6)';
              strokeColor = 'rgba(96, 96, 96, 0.8)';
              tooltip = 'No data available';
            } else {
              fillColor = getAODLevelColor(latestAod);
              strokeColor = getAODLevelColor(latestAod);
              const label = getAODLevelLabel(latestAod);
              tooltip = label ? `${site.name ?? site.site}: ${label} (AOD ${latestAod.toFixed(3)})` : `${site.name ?? site.site}: AOD ${latestAod.toFixed(3)}`;
            }
            ctx.fillStyle = fillColor;
            ctx.strokeStyle = strokeColor;
            const cp = (map as L.Map).latLngToContainerPoint([site.latitude, site.longitude]);
            const x = cp.x;
            const y = cp.y;
            ctx.beginPath();
            ctx.arc(x, y, 10, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            drawnAeronet.push({ site, x, y, tooltip });
          }
        }
      }

      const currentFirePoints = firePointsRef.current || [];
      const visiblePoints: FIRMSFirePoint[] = [];
      const maxPoints = 80000;
      for (let i = 0; i < currentFirePoints.length; i++) {
        const f = currentFirePoints[i];
        if (f.latitude >= minLat && f.latitude <= maxLat && f.longitude >= minLng && f.longitude <= maxLng) {
          visiblePoints.push(f);
        }
      }

      let toDraw = visiblePoints;
      if (visiblePoints.length > maxPoints) {
        const numBands = 80;
        const bands: FIRMSFirePoint[][] = Array.from({ length: numBands }, () => []);
        const latSpan = maxLat - minLat || 1;
        for (const p of visiblePoints) {
          const bi = Math.min(numBands - 1, Math.floor(((p.latitude - minLat) / latSpan) * numBands));
          bands[bi].push(p);
        }
        toDraw = [];
        const perBand = Math.floor(maxPoints / numBands);
        for (const band of bands) {
          if (band.length <= perBand) toDraw.push(...band);
          else {
            const step = band.length / perBand;
            for (let i = 0; i < perBand; i++) {
              toDraw.push(band[Math.min(Math.floor(i * step), band.length - 1)]);
            }
          }
        }
      }

      if (toDraw.length > 0) {
        ctx.fillStyle = '#ff0000';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.lineWidth = 1;
        for (const fire of toDraw) {
          const cp = (map as L.Map).latLngToContainerPoint([fire.latitude, fire.longitude]);
          const x = cp.x;
          const y = cp.y;
          ctx.beginPath();
          ctx.arc(x, y, 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }

      (canvas as any)._firePoints = toDraw;
      (canvas as any)._aeronetPoints = drawnAeronet;
    };

    canvas.style.left = '0';
    canvas.style.top = '0';

    const layer = L.Layer.extend({
      onAdd: function (this: L.Layer, m: L.Map) {
        const container = m.getContainer();
        if (container) container.appendChild(canvas);
        const size = m.getSize();
        canvas.width = size.x;
        canvas.height = size.y;
        canvas.style.width = size.x + 'px';
        canvas.style.height = size.y + 'px';
        _redraw();
        m.on('viewreset', _redraw);
        m.on('moveend', _redraw);
        // Only redraw when zoom ends—skip redraws during zoom for smoother interaction
        m.on('zoomend', _redraw);
        m.on('resize', _redraw);
      },
      onRemove: function (this: L.Layer, m: L.Map) {
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
        m.off('viewreset', _redraw);
        m.off('moveend', _redraw);
        m.off('zoomend', _redraw);
        m.off('resize', _redraw);
      },
    });

    const l = new layer();
    l.addTo(map);
    layerRef.current = l;

    const handleClick = (e: MouseEvent) => {
      if (!allowPointerEvents || !canvas || !map) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const aeronetPoints = (canvas as any)._aeronetPoints || [];
      let closestAeronet: AERONETSite | null = null;
      let minAeronetD = Infinity;
      for (const p of aeronetPoints) {
        const d = Math.sqrt((p.x - x) ** 2 + (p.y - y) ** 2);
        if (d < 15 && d < minAeronetD) { minAeronetD = d; closestAeronet = p.site; }
      }
      if (closestAeronet && onAeronetSiteClickRef.current) {
        try {
          onAeronetSiteClickRef.current(closestAeronet);
        } catch (err) {
          console.error('AERONET site click handler error:', err);
        }
        return;
      }

      const points = (canvas as any)._firePoints || [];
      let closest: FIRMSFirePoint | null = null;
      let minD = Infinity;
      for (const fire of points) {
        const cp = (map as L.Map).latLngToContainerPoint([fire.latitude, fire.longitude]);
        const d = Math.sqrt((cp.x - x) ** 2 + (cp.y - y) ** 2);
        if (d < 5 && d < minD) { minD = d; closest = fire; }
      }
      if (closest && onFireClickRef.current) onFireClickRef.current(closest);
    };

    const tooltip = document.createElement('div');
    tooltip.style.cssText = 'position:absolute;z-index:1000;background:rgba(0,0,0,0.85);color:#fff;padding:6px 10px;border-radius:4px;font-size:12px;pointer-events:none;display:none;white-space:nowrap;max-width:280px;overflow:hidden;text-overflow:ellipsis;';
    const container = map.getContainer();
    if (container) {
      container.style.position = 'relative';
      container.appendChild(tooltip);
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (!canvas || !allowPointerEvents) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const aeronetPoints = (canvas as any)._aeronetPoints || [];
      let hovered: { site: AERONETSite; tooltip: string } | null = null;
      for (const p of aeronetPoints) {
        const d = Math.sqrt((p.x - x) ** 2 + (p.y - y) ** 2);
        if (d < 15) {
          hovered = { site: p.site, tooltip: p.tooltip };
          break;
        }
      }
      if (hovered) {
        tooltip.textContent = hovered.tooltip;
        tooltip.style.display = 'block';
        const containerRect = container?.getBoundingClientRect();
        if (containerRect) {
          tooltip.style.left = (e.clientX - containerRect.left + 12) + 'px';
          tooltip.style.top = (e.clientY - containerRect.top + 12) + 'px';
        }
      } else {
        tooltip.style.display = 'none';
      }
    };

    const handleMouseOut = () => {
      tooltip.style.display = 'none';
    };

    canvas.addEventListener('click', handleClick);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseleave', handleMouseOut);

    return () => {
      canvas.removeEventListener('click', handleClick);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseleave', handleMouseOut);
      if (tooltip.parentNode) tooltip.parentNode.removeChild(tooltip);
      if (layerRef.current) map.removeLayer(layerRef.current);
      layerRef.current = null;
      canvasRef.current = null;
    };
  }, [map, firePoints, aeronetSites, siteAodMap, allowPointerEvents]);

  useEffect(() => {
    if (canvasRef.current) {
      canvasRef.current.style.pointerEvents = allowPointerEvents ? 'auto' : 'none';
    }
  }, [allowPointerEvents]);

  return null;
};

export default CanvasFireLayer;
