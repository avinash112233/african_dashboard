import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, LayersControl } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './MapVisualization.css';

// Fix for default marker icon
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

interface MapVisualizationProps {
  onDataSelect?: (data: any) => void;
}

const MapVisualization = ({ onDataSelect }: MapVisualizationProps) => {
  const mapRef = useRef<L.Map | null>(null);

  // Sample data points for Africa - replace with actual API data
  const sampleDataPoints = [
    { id: 1, lat: 1.2921, lng: 36.8219, name: 'Nairobi, Kenya', value: 0.45, parameter: 'AOD' },
    { id: 2, lat: -1.2921, lng: 36.8219, name: 'Lagos, Nigeria', value: 0.52, parameter: 'AOD' },
    { id: 3, lat: -26.2041, lng: 28.0473, name: 'Johannesburg, South Africa', value: 0.38, parameter: 'AOD' },
    { id: 4, lat: 30.0444, lng: 31.2357, name: 'Cairo, Egypt', value: 0.61, parameter: 'AOD' },
    { id: 5, lat: -15.3875, lng: 28.3228, name: 'Lusaka, Zambia', value: 0.41, parameter: 'AOD' },
  ];

  const handleMarkerClick = (point: any) => {
    if (onDataSelect) {
      onDataSelect({
        location: point.name,
        parameter: point.parameter,
        value: point.value,
        lat: point.lat,
        lng: point.lng,
        date: new Date().toISOString().split('T')[0],
      });
    }
  };

  // Custom marker icon with color based on value
  const getMarkerIcon = (value: number) => {
    const color = value > 0.5 ? 'red' : value > 0.4 ? 'orange' : 'green';
    return L.divIcon({
      className: 'custom-marker',
      html: `<div style="background-color: ${color}; width: 20px; height: 20px; border-radius: 50%; border: 2px solid white;"></div>`,
      iconSize: [20, 20],
    });
  };

  return (
    <MapContainer
      center={[0, 20]}
      zoom={4}
      style={{ height: '100%', width: '100%' }}
      ref={mapRef}
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
            attribution='Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          />
        </LayersControl.BaseLayer>

        <LayersControl.Overlay name="Heat Map" checked>
          {/* Heat map layer will be added here - requires leaflet.heat plugin */}
          <div>Heat map layer (to be implemented with actual data)</div>
        </LayersControl.Overlay>
      </LayersControl>

      {/* Point markers */}
      {sampleDataPoints.map((point) => (
        <Marker
          key={point.id}
          position={[point.lat, point.lng]}
          icon={getMarkerIcon(point.value)}
          eventHandlers={{
            click: () => handleMarkerClick(point),
          }}
        >
          <Popup>
            <div>
              <strong>{point.name}</strong>
              <br />
              {point.parameter}: {point.value}
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
};

export default MapVisualization;



