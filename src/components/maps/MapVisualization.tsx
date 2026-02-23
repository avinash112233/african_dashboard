import { useState, useEffect } from 'react';
import { MapContainer, TileLayer, LayerGroup, LayersControl, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import CircleSelectLayer from './CircleSelectLayer';
import CircleFireTable from './CircleFireTable';
import 'leaflet/dist/leaflet.css';
import CanvasFireLayer from './CanvasFireLayer';
import ViewportFirePanel from './ViewportFirePanel';
import AODHeatMapLayer from './AODHeatMapLayer';
import PM25HeatMapLayer from './PM25HeatMapLayer';
import './MapVisualization.css';
import type { FIRMSFirePoint } from '../../services/firmsApi';
import type { AERONETSite, SiteAODMap } from '../../services/aeronetApi';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

interface MapVisualizationProps {
  firePoints: FIRMSFirePoint[];
  aeronetSites: AERONETSite[];
  siteAodMap?: SiteAODMap;
  showFires: boolean;
  showAeronet: boolean;
  showAODHeatMap?: boolean;
  showVIIRSImagery?: boolean;
  showMERRA2PM25?: boolean;
  onPm25Sample?: (sample: { lat: number; lon: number; value: number; date: string; min: number; max: number; units: string; source: 'gesdisc' | 'sample' } | null) => void;
  onMerra2LoadingChange?: (loading: boolean) => void;
  onMerra2SourceChange?: (source: 'gesdisc' | 'sample') => void;
  onFireClick?: (fire: FIRMSFirePoint) => void;
  onAeronetSiteClick?: (site: AERONETSite) => void;
  selectedDate?: string;
  circleCenter?: [number, number] | null;
  circleRadiusKm?: number;
  circleSelectActive?: boolean;
  onCircleCenterChange?: (lat: number, lng: number) => void;
  onCircleClose?: () => void;
  pointsInCircle?: FIRMSFirePoint[];
}

const MapVisualization = ({
  firePoints,
  aeronetSites,
  siteAodMap = {},
  showFires,
  showAeronet,
  showAODHeatMap = false,
  showVIIRSImagery = false,
  showMERRA2PM25 = false,
  onPm25Sample,
  onMerra2LoadingChange,
  onMerra2SourceChange,
  onFireClick,
  onAeronetSiteClick,
  selectedDate = new Date().toISOString().slice(0, 10),
  circleCenter = null,
  circleRadiusKm = 25,
  circleSelectActive = false,
  onCircleCenterChange,
  onCircleClose,
  pointsInCircle = [],
}: MapVisualizationProps) => {
  const [cursorCoords, setCursorCoords] = useState<{ lat: number; lng: number } | null>(null);

  // Debug logs for VIIRS imagery
  useEffect(() => {
    if (showVIIRSImagery) {
      const isDev = import.meta.env.DEV;
      const base = isDev
        ? `${window.location.origin}/api/gibs`
        : 'https://gibs-a.earthdata.nasa.gov';
      const testUrl = `${base}/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${selectedDate}/GoogleMapsCompatible_Level9/5/10/10.jpg`;
      console.log('[VIIRS] Imagery enabled', { selectedDate, isDev, testUrl });
      // Diagnose tile response
      fetch(testUrl, { method: 'HEAD' })
        .then((r) => console.log('[VIIRS] Test tile response', testUrl, r.status, r.statusText))
        .catch((err) => console.error('[VIIRS] Test tile fetch failed', err));
    } else {
      console.log('[VIIRS] Imagery disabled');
    }
  }, [showVIIRSImagery, selectedDate]);

  // Africa bounds: restrict map view to continent (Cape Agulhas to Tunisia, Cape Verde to Somalia)
  const africaBounds: [[number, number], [number, number]] = [
    [-35, -18], // SW
    [37.3, 51.5], // NE
  ];

  return (
    <MapContainer
      center={[5, 20]}
      zoom={5}
      minZoom={3}
      maxBounds={africaBounds}
      maxBoundsViscosity={0.7}
      style={{ height: '100%', width: '100%', minHeight: '400px' }}
      scrollWheelZoom
    >
      <LayersControl position="topright">
        <LayersControl.BaseLayer checked name="OpenStreetMap">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
        </LayersControl.BaseLayer>
        <LayersControl.BaseLayer name="Satellite (ESRI)">
          <TileLayer
            attribution="Tiles &copy; Esri"
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          />
        </LayersControl.BaseLayer>
        <LayersControl.BaseLayer name="Satellite + Labels (NASA-style)">
          <LayerGroup>
            <TileLayer
              attribution="Imagery &copy; Esri"
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            />
            <TileLayer
              attribution="Labels &copy; <a href='https://carto.com/attributions' target='_blank' rel='noopener'>CARTO</a>"
              url="https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png"
              subdomains={['a', 'b', 'c', 'd']}
              pane="overlayPane"
              zIndex={399}
            />
          </LayerGroup>
        </LayersControl.BaseLayer>
      </LayersControl>

      {showVIIRSImagery && (
        <TileLayer
          attribution='VIIRS &copy; <a href="https://www.earthdata.nasa.gov" target="_blank" rel="noopener">NASA GIBS</a>'
          url={
            import.meta.env.DEV
              ? `/api/gibs/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${selectedDate}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`
              : `https://gibs-{s}.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${selectedDate}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`
          }
          subdomains={['a', 'b', 'c']}
          pane="overlayPane"
          maxNativeZoom={8}
          maxZoom={18}
          opacity={0.9}
          zIndex={350}
        />
      )}

      {showAODHeatMap && (
        <AODHeatMapLayer aeronetSites={aeronetSites} siteAodMap={siteAodMap} />
      )}

      {showMERRA2PM25 && (
        <PM25HeatMapLayer
          date={selectedDate}
          opacity={0.65}
          onPm25Sample={onPm25Sample}
          onLoadingChange={onMerra2LoadingChange}
          onSourceChange={onMerra2SourceChange}
        />
      )}

      {(showFires || showAeronet) && (
        <>
          <CanvasFireLayer
            firePoints={showFires ? firePoints : []}
            onFireClick={onFireClick}
            aeronetSites={showAeronet ? aeronetSites : []}
            siteAodMap={siteAodMap}
            onAeronetSiteClick={onAeronetSiteClick}
            allowPointerEvents={!circleSelectActive}
          />
          {showFires && circleSelectActive && (
            <CircleSelectLayer
              center={circleCenter}
              radiusKm={circleRadiusKm}
              onCenterChange={onCircleCenterChange ?? (() => {})}
              active={circleSelectActive}
            />
          )}
          {showFires && circleCenter && (
            <CircleFireTable points={pointsInCircle} onFireClick={onFireClick} onClose={onCircleClose} />
          )}
          {showFires && !circleCenter && (
            <ViewportFirePanel
              firePoints={firePoints}
              onFireClick={onFireClick}
              minZoomToShow={7}
            />
          )}
        </>
      )}

      <MapMouseEvents onCoords={setCursorCoords} />

      {cursorCoords && (
        <div
          className="map-coords-bar"
          style={{
            position: 'absolute',
            bottom: 40,
            left: 10,
            background: 'rgba(60,60,60,0.9)',
            color: '#fff',
            padding: '6px 10px',
            borderRadius: 4,
            fontSize: 12,
            zIndex: 1000,
            fontFamily: 'monospace',
          }}
        >
          Lat: {cursorCoords.lat.toFixed(4)}  Lon: {cursorCoords.lng.toFixed(4)}
        </div>
      )}
    </MapContainer>
  );
};

function MapMouseEvents({ onCoords }: { onCoords: (c: { lat: number; lng: number } | null) => void }) {
  useMapEvents({
    mousemove: (e) => onCoords(e.latlng),
    mouseout: () => onCoords(null),
  });
  return null;
}

export default MapVisualization;
