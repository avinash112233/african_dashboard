import { OPENAQ_LINK_PREFERRED_KM } from './constants';
import { findNearestStationWithDistance, type GeoStation } from './linkStations';
import type { AnalysisLocationContext } from './types';

export interface ColocationResult {
  location: AnalysisLocationContext;
  /** True only when MERRA2 link is still missing and no preloaded station list was provided. */
  needsAsyncMerra2List: boolean;
}

type Merra2ColocationStation = GeoStation;
type OpenAqColocationStation = {
  latitude: number;
  longitude: number;
  sensorId: number;
  name: string;
  locationId?: number;
};

/** Resolve nearest MERRA2 / OpenAQ links synchronously when station lists are already loaded. */
export function resolveColocationLinks(
  base: AnalysisLocationContext,
  merra2Stations?: Merra2ColocationStation[],
  openAqStations?: OpenAqColocationStation[]
): ColocationResult {
  let next: AnalysisLocationContext = { ...base };
  const needsMerra2Link = next.merra2Sitename == null;
  const needsOpenAqLink = next.openaqSensorId == null;

  if (needsMerra2Link && merra2Stations?.length) {
    const nearest = findNearestStationWithDistance(
      base.latitude,
      base.longitude,
      merra2Stations
    );
    if (nearest) {
      next = {
        ...next,
        merra2Sitename: nearest.station.sitename,
        merra2LinkDistanceKm: nearest.distanceKm,
        merra2LinkBeyondPreferred: nearest.isBeyondPreferred,
      };
    }
  }

  if (needsOpenAqLink && openAqStations?.length) {
    const nearestOaq = findNearestStationWithDistance(
      base.latitude,
      base.longitude,
      openAqStations.map((s) => ({
        latitude: s.latitude,
        longitude: s.longitude,
        sitename: String(s.sensorId),
      }))
    );
    if (nearestOaq) {
      const match = openAqStations.find(
        (s) => String(s.sensorId) === nearestOaq.station.sitename
      );
      if (match) {
        next = {
          ...next,
          openaqSensorId: match.sensorId,
          openaqLocationId: match.locationId,
          openaqLocationName: match.name,
          openaqLinkDistanceKm: nearestOaq.distanceKm,
          openaqLinkBeyondPreferred: nearestOaq.distanceKm > OPENAQ_LINK_PREFERRED_KM,
        };
      }
    }
  }

  return {
    location: next,
    needsAsyncMerra2List: next.merra2Sitename == null && needsMerra2Link && !merra2Stations?.length,
  };
}
