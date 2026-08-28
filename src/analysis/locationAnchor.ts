import type { AnalysisAnchorSource, AnalysisLocationContext } from './types';

const ANCHOR_SOURCE_LABEL: Record<AnalysisAnchorSource, string> = {
  aeronet: 'AERONET site',
  merra2: 'MERRA2 station',
  openaq: 'OpenAQ monitor',
  washu: 'WashU location',
  aaqe: 'AAQE forecast point',
  fire: 'Fire detection',
};

export function anchorSourceLabel(source: AnalysisAnchorSource): string {
  return ANCHOR_SOURCE_LABEL[source];
}

export function anchorFromAeronet(site: {
  name?: string;
  site: string;
  latitude: number;
  longitude: number;
}): AnalysisLocationContext {
  const querySite = site.name && site.name !== site.site ? site.name : site.site;
  return {
    label: site.name ?? site.site,
    latitude: site.latitude,
    longitude: site.longitude,
    anchorSource: 'aeronet',
    aeronetQuerySite: querySite,
  };
}

export function anchorFromMerra2(station: {
  sitename: string;
  latitude: number;
  longitude: number;
}): AnalysisLocationContext {
  return {
    label: station.sitename,
    latitude: station.latitude,
    longitude: station.longitude,
    anchorSource: 'merra2',
    merra2Sitename: station.sitename,
    merra2LinkDistanceKm: 0,
  };
}

export function anchorFromAaqe(point: {
  latitude: number;
  longitude: number;
  siteName?: string;
  station?: string;
}): AnalysisLocationContext {
  return {
    label: point.siteName ?? point.station ?? 'AAQE site',
    latitude: point.latitude,
    longitude: point.longitude,
    anchorSource: 'aaqe',
  };
}

export function anchorFromOpenAq(station: {
  name: string;
  latitude: number;
  longitude: number;
  sensorId: number;
  locationId?: number;
}): AnalysisLocationContext {
  return {
    label: station.name,
    latitude: station.latitude,
    longitude: station.longitude,
    anchorSource: 'openaq',
    openaqSensorId: station.sensorId,
    openaqLocationId: station.locationId,
    openaqLocationName: station.name,
    openaqLinkDistanceKm: 0,
  };
}

export function anchorFromFire(latitude: number, longitude: number): AnalysisLocationContext {
  return {
    label: `Fire (${latitude.toFixed(2)}, ${longitude.toFixed(2)})`,
    latitude,
    longitude,
    anchorSource: 'fire',
  };
}

export function anchorFromWashuStation(station: {
  sitename: string;
  latitude: number;
  longitude: number;
}): AnalysisLocationContext {
  return {
    label: station.sitename,
    latitude: station.latitude,
    longitude: station.longitude,
    anchorSource: 'washu',
    washuSitename: station.sitename,
  };
}

export function anchorFromWashuLocation(
  latitude: number,
  longitude: number,
  label?: string
): AnalysisLocationContext {
  return {
    label: label ?? `WashU (${latitude.toFixed(2)}, ${longitude.toFixed(2)})`,
    latitude,
    longitude,
    anchorSource: 'washu',
  };
}
