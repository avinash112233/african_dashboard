import type { AnalysisAnchorSource, AnalysisLocationContext } from './types';

const ANCHOR_SOURCE_LABEL: Record<AnalysisAnchorSource, string> = {
  aeronet: 'AERONET site',
  merra2: 'MERRA2 station',
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

export function anchorFromFire(latitude: number, longitude: number): AnalysisLocationContext {
  return {
    label: `Fire (${latitude.toFixed(2)}, ${longitude.toFixed(2)})`,
    latitude,
    longitude,
    anchorSource: 'fire',
  };
}
