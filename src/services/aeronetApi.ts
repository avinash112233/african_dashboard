// AERONET API proxy — /api/aeronet → aeronet.gsfc.nasa.gov
// Includes in-memory + localStorage caching with stale-while-revalidate.

const API_BASE = '/api/aeronet';

export interface AERONETSite {
  site: string;
  latitude: number;
  longitude: number;
  elevation?: number;
  name?: string;
}

export interface AERONETDataPoint {
  date: string;
  time?: string;
  dayOfYear?: number;
  AOD_500nm?: number;
  AOD_675nm?: number;
  AOD_870nm?: number;
  AOD_1020nm?: number;
}

export type AERONETAODVersion = 1 | 1.5 | 2;

function getAodVersionParam(version: AERONETAODVersion): 'AOD10' | 'AOD15' | 'AOD20' {
  if (version === 1) return 'AOD10';
  if (version === 1.5) return 'AOD15';
  return 'AOD20';
}

export interface SiteAODMap {
  [siteId: string]:
    | { hasData: true; AOD_500nm?: number; AOD_675nm?: number; AOD_870nm?: number; AOD_1020nm?: number }
    | { hasData: false };
}

type CacheEntry<T> = { data: T; ts: number };

const CACHE_TTL_MS        = 30 * 60 * 1000;
const CACHE_SITES_TTL_MS  = 24 * 60 * 60 * 1000;
const CACHE_AFRICA_TTL_MS = 30 * 60 * 1000;
const LS_SITES_KEY   = 'aqf_aeronet_sites_v1';
const LS_AFRICA_KEY  = 'aqf_aeronet_africa_v1';

const cacheSites    = { entry: null as CacheEntry<AERONETSite[]> | null };
const cacheAfrica   = new Map<string, CacheEntry<SiteAODMap>>();
const cacheSiteData = new Map<string, CacheEntry<AERONETDataPoint[]>>();
const MAX_AFRICA_CACHE = 20;
const MAX_SITE_CACHE   = 50;

function pruneCache<T>(m: Map<string, CacheEntry<T>>, max: number) {
  if (m.size <= max) return;
  const entries = [...m.entries()].sort((a, b) => a[1].ts - b[1].ts);
  for (let i = 0; i < entries.length - max; i++) m.delete(entries[i][0]);
}

function lsRead<T>(key: string, ttlMs: number): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry: CacheEntry<T> = JSON.parse(raw);
    if (Date.now() - entry.ts > ttlMs) { localStorage.removeItem(key); return null; }
    return entry.data;
  } catch { return null; }
}

function lsWrite<T>(key: string, data: T): void {
  try {
    localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() }));
  } catch { /* quota exceeded */ }
}

// Parses aeronet_locations_extended_v3.txt (tab- or comma-separated, flexible headers).
function parseLocationsText(text: string): AERONETSite[] {
  const sites: AERONETSite[] = [];
  const lines = text.split('\n').filter((l) => l.trim());
  if (lines.length < 2) return sites;

  const sep = text.includes('\t') ? '\t' : ',';
  let headerLineIdx = 0;
  let latIdx = -1, lonIdx = -1, siteIdx = -1, nameIdx = -1, elevIdx = -1;

  for (let h = 0; h < Math.min(5, lines.length); h++) {
    const cols = lines[h].split(sep).map((c) => c.trim().toLowerCase());
    const li = cols.findIndex((c) => c.includes('lat') || c === 'latitude');
    const lo = cols.findIndex((c) => c.includes('lon') || c === 'longitude');
    const si = cols.findIndex((c) => c.includes('new_site') || (c === 'site') || (c.includes('site') && !c.includes('datetime')));
    const ni = cols.findIndex((c) => c === 'name');
    const ei = cols.findIndex((c) => c.includes('elev') || c.includes('alt'));
    if (li >= 0 && lo >= 0 && (si >= 0 || ni >= 0)) {
      headerLineIdx = h; latIdx = li; lonIdx = lo;
      siteIdx = si >= 0 ? si : ni; nameIdx = ni >= 0 ? ni : si; elevIdx = ei;
      break;
    }
  }
  if (latIdx < 0 || lonIdx < 0) return sites;

  for (let i = headerLineIdx + 1; i < lines.length; i++) {
    const cells = lines[i].split(sep).map((c) => c.trim());
    const lat = parseFloat(cells[latIdx]);
    const lon = parseFloat(cells[lonIdx]);
    const site = (siteIdx >= 0 ? cells[siteIdx] : null) || (nameIdx >= 0 ? cells[nameIdx] : null) || `Site_${i}`;
    const name = nameIdx >= 0 && nameIdx !== siteIdx ? cells[nameIdx] : site;
    if (!isNaN(lat) && !isNaN(lon) && site) {
      const elev = elevIdx >= 0 ? parseFloat(cells[elevIdx]) : undefined;
      sites.push({ site, latitude: lat, longitude: lon, elevation: !isNaN(elev as number) ? elev : undefined, name: name || site });
    }
  }
  return sites;
}

async function fetchAndCacheSites(): Promise<AERONETSite[]> {
  const res = await fetch(`${API_BASE}/aeronet_locations_extended_v3.txt`);
  if (!res.ok) throw new Error(`AERONET API ${res.status}`);
  const all = parseLocationsText(await res.text());
  // Africa bounding box filter
  const sites = all.filter((s) => s.latitude >= -37 && s.latitude <= 37 && s.longitude >= -18 && s.longitude <= 52);
  cacheSites.entry = { data: sites, ts: Date.now() };
  lsWrite(LS_SITES_KEY, sites);
  return sites;
}

/**
 * Returns African AERONET sites.
 * Stale-while-revalidate: serves cached data immediately, refreshes in background when stale.
 * Falls back to any localStorage data (even expired) when NASA is unreachable.
 */
export async function getAfricanAERONETSites(): Promise<AERONETSite[]> {
  const now = Date.now();

  if (cacheSites.entry && now - cacheSites.entry.ts < CACHE_SITES_TTL_MS) {
    return cacheSites.entry.data;
  }

  // Return localStorage data immediately; trigger a background refresh if stale.
  const lsCached = lsRead<AERONETSite[]>(LS_SITES_KEY, CACHE_SITES_TTL_MS * 3);
  if (lsCached) {
    cacheSites.entry = { data: lsCached, ts: now };
    const lsEntry = (() => { try { return JSON.parse(localStorage.getItem(LS_SITES_KEY) ?? '{}'); } catch { return {}; } })();
    if (now - (lsEntry.ts ?? 0) > CACHE_SITES_TTL_MS) {
      fetchAndCacheSites().catch(() => {});
    }
    return lsCached;
  }

  try {
    return await fetchAndCacheSites();
  } catch (err) {
    console.error('[AERONET] NASA unreachable:', err);
    // Emergency: serve any stale localStorage data rather than returning empty.
    const stale = lsRead<AERONETSite[]>(LS_SITES_KEY, Infinity);
    if (stale) { cacheSites.entry = { data: stale, ts: now }; return stale; }
    return cacheSites.entry?.data ?? [];
  }
}

export async function getAERONETData(
  site: string,
  startDate: string,
  endDate: string,
  aodVersion: AERONETAODVersion = 1.5
): Promise<AERONETDataPoint[]> {
  const key = `${site}|${startDate}|${endDate}|${aodVersion}`;
  const cached = cacheSiteData.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;

  try {
    const [y1, m1, d1] = startDate.split('-').map(Number);
    const [y2, m2, d2] = endDate.split('-').map(Number);
    const aodParamKey = getAodVersionParam(aodVersion);
    const params = new URLSearchParams({
      site,
      year: String(y1), month: String(m1).padStart(2, '0'), day: String(d1).padStart(2, '0'),
      year2: String(y2), month2: String(m2).padStart(2, '0'), day2: String(d2).padStart(2, '0'),
      [aodParamKey]: '1',
      AVG: '20',
      if_no_html: '1',
    });
    const res = await fetch(`${API_BASE}/cgi-bin/print_web_data_v3?${params}`);
    if (!res.ok) return [];
    const text = await res.text();
    const lines = text.split('\n').filter((l) => l.trim());
    if (lines.length < 2) return [];

    let headerLineIdx = 0;
    for (let h = 0; h < Math.min(10, lines.length); h++) {
      const row = lines[h];
      if (row.includes('Date') && !row.includes('End_Date') &&
          (/aod|aot/i.test(row) && /500|675|870|1020/.test(row) || row.split(',').length > 5)) {
        headerLineIdx = h;
        break;
      }
    }
    const colsArr = lines[headerLineIdx].split(',');
    const dateIdx  = colsArr.findIndex((c) => c.includes('Date') && !c.includes('End'));
    const timeIdx  = colsArr.findIndex((c) => c.toLowerCase().includes('time') && !c.includes('datetime'));
    const doyIdx   = colsArr.findIndex((c) => /day_of_year|dayofyear/i.test(c));
    const findAod  = (w: string) => colsArr.findIndex((c) => /aod|aot/i.test(c) && c.includes(w));
    const aod500Idx = findAod('500'), aod675Idx = findAod('675');
    const aod870Idx = findAod('870'), aod1020Idx = findAod('1020');

    const points: AERONETDataPoint[] = [];
    for (let i = headerLineIdx + 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      const date = dateIdx >= 0 ? cols[dateIdx]?.trim() : cols[0]?.trim() || '';
      if (!date || date.startsWith(';') || date === 'AERONET') continue;
      const toAod = (v: number | undefined) => v == null || isNaN(v) || v < -900 ? undefined : v;
      points.push({
        date,
        time: timeIdx >= 0 ? cols[timeIdx]?.trim() : undefined,
        dayOfYear: doyIdx >= 0 ? parseInt(cols[doyIdx], 10) : undefined,
        AOD_500nm:  toAod(aod500Idx  >= 0 ? parseFloat(cols[aod500Idx])  : undefined),
        AOD_675nm:  toAod(aod675Idx  >= 0 ? parseFloat(cols[aod675Idx])  : undefined),
        AOD_870nm:  toAod(aod870Idx  >= 0 ? parseFloat(cols[aod870Idx])  : undefined),
        AOD_1020nm: toAod(aod1020Idx >= 0 ? parseFloat(cols[aod1020Idx]) : undefined),
      });
    }
    pruneCache(cacheSiteData, MAX_SITE_CACHE);
    cacheSiteData.set(key, { data: points, ts: Date.now() });
    return points;
  } catch (err) {
    console.error('[AERONET] getAERONETData error:', err);
    return [];
  }
}

const AFRICA_BBOX = { south: -37, west: -18, north: 37, east: 52 };

/**
 * AOD data for all African sites in a date range — used to color-code map markers.
 * Cached 30 min in memory + localStorage; falls back to stale cache on error.
 */
export async function getAERONETDataAfrica(
  startDate: string,
  endDate: string,
  aodVersion: AERONETAODVersion = 1.5
): Promise<SiteAODMap> {
  const key = `${startDate}|${endDate}|${aodVersion}`;
  const now = Date.now();

  const cached = cacheAfrica.get(key);
  if (cached && now - cached.ts < CACHE_AFRICA_TTL_MS) return cached.data;

  const lsKey = `${LS_AFRICA_KEY}_${key}`;
  const lsCached = lsRead<SiteAODMap>(lsKey, CACHE_AFRICA_TTL_MS);
  if (lsCached) { cacheAfrica.set(key, { data: lsCached, ts: now }); return lsCached; }

  const map: SiteAODMap = {};
  try {
    const [y1, m1, d1] = startDate.split('-').map(Number);
    const [y2, m2, d2] = endDate.split('-').map(Number);
    const aodParamKey = getAodVersionParam(aodVersion);
    const params = new URLSearchParams({
      year: String(y1), month: String(m1).padStart(2, '0'), day: String(d1).padStart(2, '0'),
      year2: String(y2), month2: String(m2).padStart(2, '0'), day2: String(d2).padStart(2, '0'),
      lat1: String(AFRICA_BBOX.south), lon1: String(AFRICA_BBOX.west),
      lat2: String(AFRICA_BBOX.north), lon2: String(AFRICA_BBOX.east),
      [aodParamKey]: '1',
      AVG: '20',
      if_no_html: '1',
    });
    const res = await fetch(`${API_BASE}/cgi-bin/print_web_data_v3?${params}`);
    if (!res.ok) return map;
    const lines = (await res.text()).split('\n').filter((l) => l.trim());
    if (lines.length < 2) return map;

    let headerLineIdx = 0;
    for (let h = 0; h < Math.min(10, lines.length); h++) {
      const row = lines[h];
      if (row.includes('Date') && !row.includes('End_Date') &&
          (/site/i.test(row) || /aod|aot/i.test(row) || row.split(',').length > 5)) {
        headerLineIdx = h; break;
      }
    }
    const colsArr  = lines[headerLineIdx].split(',');
    const siteIdx  = colsArr.findIndex((c) => c.toLowerCase().includes('site') && !c.includes('datetime'));
    const findAod  = (w: string) => colsArr.findIndex((c) => /aod|aot/i.test(c) && c.includes(w));
    const aod500Idx = findAod('500'), aod675Idx = findAod('675');
    const aod870Idx = findAod('870'), aod1020Idx = findAod('1020');
    if (siteIdx < 0) return map;

    const toAod = (v: number) => (v == null || isNaN(v) || v < -900 ? NaN : v);
    for (let i = headerLineIdx + 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      const site = cols[siteIdx]?.trim();
      if (!site || site.startsWith(';') || site === 'AERONET') continue;
      const aod500  = toAod(aod500Idx  >= 0 ? parseFloat(cols[aod500Idx])  : NaN);
      const aod675  = toAod(aod675Idx  >= 0 ? parseFloat(cols[aod675Idx])  : NaN);
      const aod870  = toAod(aod870Idx  >= 0 ? parseFloat(cols[aod870Idx])  : NaN);
      const aod1020 = toAod(aod1020Idx >= 0 ? parseFloat(cols[aod1020Idx]) : NaN);
      if (isNaN(aod500) && isNaN(aod675) && isNaN(aod870) && isNaN(aod1020)) continue;
      map[site] = {
        hasData: true,
        AOD_500nm:  !isNaN(aod500)  ? aod500  : undefined,
        AOD_675nm:  !isNaN(aod675)  ? aod675  : undefined,
        AOD_870nm:  !isNaN(aod870)  ? aod870  : undefined,
        AOD_1020nm: !isNaN(aod1020) ? aod1020 : undefined,
      };
    }
    pruneCache(cacheAfrica, MAX_AFRICA_CACHE);
    cacheAfrica.set(key, { data: map, ts: now });
    lsWrite(lsKey, map);
    return map;
  } catch (err) {
    console.error('[AERONET] getAERONETDataAfrica error:', err);
    return lsRead<SiteAODMap>(lsKey, Infinity) ?? map;
  }
}
