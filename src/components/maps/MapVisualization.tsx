import { useState } from 'react';
import { MapContainer, TileLayer, LayersControl, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import CanvasFireLayer from './CanvasFireLayer';
import ViewportFirePanel from './ViewportFirePanel';
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
  onFireClick?: (fire: FIRMSFirePoint) => void;
  onAeronetSiteClick?: (site: AERONETSite) => void;
  selectedDate?: string;
}

const MapVisualization = ({
  firePoints,
  aeronetSites,
  siteAodMap = {},
  showFires,
  showAeronet,
  onFireClick,
  onAeronetSiteClick,
}: MapVisualizationProps) => {
  const [cursorCoords, setCursorCoords] = useState<{ lat: number; lng: number } | null>(null);

  return (
    <MapContainer
      center={[5, 20]}
      zoom={5}
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
      </LayersControl>

      {(showFires || showAeronet) && (
        <>
          <CanvasFireLayer
            firePoints={showFires ? firePoints : []}
            onFireClick={onFireClick}
            aeronetSites={showAeronet ? aeronetSites : []}
            siteAodMap={siteAodMap}
            onAeronetSiteClick={onAeronetSiteClick}
            allowPointerEvents={true}
          />
          {showFires && (
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
