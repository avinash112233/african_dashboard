import { useState, memo } from 'react';
import { MapContainer, TileLayer, LayerGroup, LayersControl, useMapEvents, CircleMarker, Tooltip } from 'react-leaflet';
import Merra2StationsLayer from './Merra2StationsLayer';
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
import type { AAQEForecastPoint } from '../../services/aaqeForecastApi';
import { getAaqeDisplayValues } from '../../services/aaqeForecastApi';
import { calculateAQIFromPm25, getAqiCategory } from '../../utils/aqiUtils';
import type { AaqeDisplayType } from '../../services/aaqeForecastApi';

function getContrastingTextColor(hexColor: string): string {
  const hex = hexColor.replace('#', '');
  if (hex.length !== 6) return '#111827';
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.65 ? '#111827' : '#ffffff';
}

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
  showAAQEForecast?: boolean;
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
  aaqeForecastPoints?: AAQEForecastPoint[];
  aaqeForecastTimeCode?: string;
  aaqeForecastDate?: string;
  aaqeDisplayType?: AaqeDisplayType;
  onAAQEForecastClick?: (point: AAQEForecastPoint) => void;
}

const MapVisualization = ({
  firePoints,
  aeronetSites,
  siteAodMap = {},
  showFires,
  showAeronet,
  showVIIRSImagery = false,
  showMERRA2PM25 = false,
  showAAQEForecast = false,
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
  aaqeForecastPoints = [],
  aaqeForecastTimeCode = '1330',
  aaqeForecastDate: _aaqeForecastDate,
  aaqeDisplayType = 'DAILY_AQI',
  onAAQEForecastClick,
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
        <Merra2StationsLayer
          stations={merra2Stations}
          active
          onStationClick={(s) => {
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
          }}
        />
      )}

      {showAAQEForecast && (
        <>
          {aaqeForecastPoints.map((p, idx) => {
            const { aqi: displayAqi, pm: displayPm, valueForColor } = getAaqeDisplayValues(
              p.properties,
              aaqeDisplayType,
              aaqeForecastTimeCode
            );
            const typeLabels: Record<AaqeDisplayType, string> = {
              DAILY_AQI: 'DAILY AQI',
              AQI: 'AQI',
              PM: 'PM 2.5',
            };
            const aqiLabel = typeLabels[aaqeDisplayType];
            const colorAqi =
              aaqeDisplayType === 'PM' && displayPm != null
                ? calculateAQIFromPm25(displayPm)
                : valueForColor;
            const aqiCategory = getAqiCategory(colorAqi);
            return (
              <CircleMarker
                key={`aaqe-${p.properties.Station ?? p.properties.Site_Name ?? idx}-${p.latitude}-${p.longitude}`}
                center={[p.latitude, p.longitude]}
                radius={6}
                pathOptions={{
                  color: '#334155',
                  weight: 0.7,
                  fillColor: aqiCategory.color,
                  fillOpacity: 0.9,
                }}
                eventHandlers={{
                  click: () => onAAQEForecastClick?.(p),
                }}
              >
                <Tooltip direction="top" offset={[0, -8]} className="aaqe-hover-tooltip">
                  <div
                    className="aaqe-tooltip-card"
                    style={{ backgroundColor: aqiCategory.color, color: getContrastingTextColor(aqiCategory.color) }}
                  >
                    <div className="aaqe-tooltip-close" aria-hidden="true" style={{ color: getContrastingTextColor(aqiCategory.color) }}>×</div>
                    <div><strong>Site Name:</strong> {(p.properties.Site_Name as string) ?? 'Forecast Site'}</div>
                    <div><strong>Source:</strong> African AQE</div>
                    <div className="aaqe-tooltip-summary">
                      {aaqeDisplayType === 'PM' ? (
                        <>
                          <strong>{aqiLabel}:</strong> {displayPm != null ? Math.round(displayPm) : '—'} µgm<sup>-3</sup>
                        </>
                      ) : (
                        <>
                          <strong>{aqiLabel}:</strong> {displayAqi != null ? Math.round(displayAqi) : '—'}{' '}
                          <strong>PM2.5:</strong> {displayPm != null ? Math.round(displayPm) : '—'} µgm<sup>-3</sup>
                        </>
                      )}
                    </div>
                  </div>
                </Tooltip>
              </CircleMarker>
            );
          })}
        </>
      )}

      {(showFires || showAeronet) && (
        <CanvasFireLayer
          showAeronet={showAeronet}
          showFires={showFires}
          firePoints={firePoints}
          onFireClick={onFireClick}
          aeronetSites={aeronetSites}
          siteAodMap={siteAodMap}
          onAeronetSiteClick={onAeronetSiteClick}
          allowPointerEvents={!circleSelectActive && !fireChartRectDrawActive}
        />
      )}
      {showFires && (
        <>
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
      {showAAQEForecast && (
        <div className="aaqe-bottom-legend" aria-label="AQI category legend">
          <div className="aaqe-bottom-legend-row aaqe-bottom-legend-row--labels">
            <span style={{ background: '#00e400' }}>Good</span>
            <span style={{ background: '#ffff00' }}>Moderate</span>
            <span style={{ background: '#ff7e00' }}>Unhealthy for sensitive groups</span>
            <span style={{ background: '#ff0000', color: '#fff' }}>Unhealthy</span>
            <span style={{ background: '#8f3f97', color: '#fff' }}>Very unhealthy</span>
            <span style={{ background: '#7e0023', color: '#fff' }}>Hazardous</span>
          </div>
          <div className="aaqe-bottom-legend-row aaqe-bottom-legend-row--ranges">
            <span>0-50</span>
            <span>51-100</span>
            <span>101-150</span>
            <span>151-200</span>
            <span>201-300</span>
            <span>301+</span>
          </div>
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

export default memo(MapVisualization);
