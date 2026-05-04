import { useState } from 'react';
import { MapContainer, TileLayer, LayerGroup, LayersControl, useMapEvents, CircleMarker, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import CircleSelectLayer from './CircleSelectLayer';
import CircleFireTable from './CircleFireTable';
import FireChartRectangleLayer from './FireChartRectangleLayer';
import 'leaflet/dist/leaflet.css';
import CanvasFireLayer from './CanvasFireLayer';
import './MapVisualization.css';
import type { FIRMSFirePoint } from '../../services/firmsApi';
import type { AERONETSite, SiteAODMap } from '../../services/aeronetApi';
import type { LatLonBounds } from '../../utils/geoUtils';
import type { MERRA2StationDailyRecord } from '../../services/merra2Api';
import { calculateAQIFromPm25, getAqiCategory } from '../../utils/aqiUtils';

const EMPTY_FIRE_POINTS: FIRMSFirePoint[] = [];
const EMPTY_AERONET_SITES: AERONETSite[] = [];

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
  showVIIRSImagery?: boolean;
  showMERRA2PM25?: boolean;
  onPm25Sample?: (sample: { lat: number; lon: number; value: number; date: string; min: number; max: number; units: string; source: 'gesdisc' | 'sample' } | null) => void;
  onFireClick?: (fire: FIRMSFirePoint) => void;
  onAeronetSiteClick?: (site: AERONETSite) => void;
  selectedDate?: string;
  circleCenter?: [number, number] | null;
  circleRadiusKm?: number;
  circleSelectActive?: boolean;
  onCircleCenterChange?: (lat: number, lng: number) => void;
  onCircleClose?: () => void;
  pointsInCircle?: FIRMSFirePoint[];
  /** When true, user can drag a rectangle to filter fire charts */
  fireChartRectDrawActive?: boolean;
  /** Committed axis-aligned bounds for fire chart spatial filter */
  fireChartBounds?: LatLonBounds | null;
  onFireChartBoundsCommit?: (bounds: LatLonBounds) => void;
  merra2Stations?: MERRA2StationDailyRecord[];
  onMerra2StationClick?: (station: MERRA2StationDailyRecord) => void;
}

const MapVisualization = ({
  firePoints,
  aeronetSites,
  siteAodMap = {},
  showFires,
  showAeronet,
  showVIIRSImagery = false,
  showMERRA2PM25 = false,
  onPm25Sample,
  onFireClick,
  onAeronetSiteClick,
  selectedDate = new Date().toISOString().slice(0, 10),
  circleCenter = null,
  circleRadiusKm = 5,
  circleSelectActive = false,
  onCircleCenterChange,
  onCircleClose,
  pointsInCircle = [],
  fireChartRectDrawActive = false,
  fireChartBounds = null,
  onFireChartBoundsCommit,
  merra2Stations = [],
  onMerra2StationClick,
}: MapVisualizationProps) => {
  const [cursorCoords, setCursorCoords] = useState<{ lat: number; lng: number } | null>(null);

  return (
    <div className="map-visualization-root">
    <MapContainer
      center={[5, 20]}
      zoom={5}
      minZoom={2}
      style={{ height: '100%', width: '100%', minHeight: '400px' }}
      scrollWheelZoom
      preferCanvas
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

      {showMERRA2PM25 && (
        <>
          {merra2Stations.map((s) => {
            const aqi = calculateAQIFromPm25(s.pm25);
            const aqiCategory = getAqiCategory(aqi);
            return (
            <CircleMarker
              key={`merra2-${s.sitename}-${s.latitude}-${s.longitude}`}
              center={[s.latitude, s.longitude]}
              radius={6}
              pathOptions={{
                color: '#334155',
                weight: 0.7,
                fillColor: aqiCategory.color,
                fillOpacity: 0.9,
              }}
              eventHandlers={{
                click: () => {
                  onMerra2StationClick?.(s);
                  onPm25Sample?.({
                    lat: s.latitude,
                    lon: s.longitude,
                    value: s.pm25,
                    date: s.date,
                    min: 0,
                    max: 0,
                    units: 'µg/m³',
                    source: 'gesdisc',
                  });
                },
              }}
            >
              <Tooltip direction="top" offset={[0, -4]}>
                {s.sitename}: AQI {aqi ?? '—'} ({aqiCategory.label}) · PM2.5 {s.pm25.toFixed(2)} µg/m³
              </Tooltip>
            </CircleMarker>
            );
          })}
        </>
      )}

      {(showFires || showAeronet) && (
        <>
          <CanvasFireLayer
            firePoints={showFires ? firePoints : EMPTY_FIRE_POINTS}
            onFireClick={onFireClick}
            aeronetSites={showAeronet ? aeronetSites : EMPTY_AERONET_SITES}
            siteAodMap={siteAodMap}
            onAeronetSiteClick={onAeronetSiteClick}
            allowPointerEvents={!circleSelectActive && !fireChartRectDrawActive}
          />
          {showFires && circleSelectActive && (
            <CircleSelectLayer
              center={circleCenter}
              radiusKm={circleRadiusKm}
              onCenterChange={onCircleCenterChange ?? (() => {})}
              active={circleSelectActive}
            />
          )}
          {showFires && (fireChartRectDrawActive || fireChartBounds) && (
            <FireChartRectangleLayer
              drawActive={fireChartRectDrawActive}
              committedBounds={fireChartBounds}
              onCommit={onFireChartBoundsCommit ?? (() => {})}
            />
          )}
          {showFires && (circleCenter || fireChartBounds) && (
            <CircleFireTable points={pointsInCircle} onFireClick={onFireClick} onClose={onCircleClose} />
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
    </div>
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
