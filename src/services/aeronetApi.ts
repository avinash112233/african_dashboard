/**
 * AERONET API - Aerosol data and site list
 * Proxy: /api/aeronet -> aeronet.gsfc.nasa.gov
 */

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

/** Site ID -> AOD values for selected date range */
export interface SiteAODMap {
  [siteId: string]:
    | { hasData: true; AOD_500nm?: number; AOD_675nm?: number; AOD_870nm?: number; AOD_1020nm?: number }
    | { hasData: false };
}

/**
 * Parse AERONET locations extended text format
 * See: https://aeronet.gsfc.nasa.gov/aeronet_locations_extended_v3.txt
 */
function parseLocationsText(text: string): AERONETSite[] {
  const sites: AERONETSite[] = [];
  const lines = text.split('\n').filter((l) => l.trim());
  if (lines.length < 2) return sites;

  const sep = text.includes('\t') ? '\t' : ',';
  let headerLineIdx = 0;
  let latIdx = -1;
  let lonIdx = -1;
  let siteIdx = -1;
  let nameIdx = -1;
  let elevIdx = -1;

  for (let h = 0; h < Math.min(5, lines.length); h++) {
    const cols = lines[h].split(sep).map((c) => c.trim().toLowerCase());
    const li = cols.findIndex((c) => c.includes('lat') || c === 'latitude');
    const lo = cols.findIndex((c) => c.includes('lon') || c === 'longitude');
    const si = cols.findIndex((c) => c.includes('new_site') || (c === 'site') || (c.includes('site') && !c.includes('datetime')));
    const ni = cols.findIndex((c) => c === 'name');
    const ei = cols.findIndex((c) => c.includes('elev') || c.includes('alt'));
    if (li >= 0 && lo >= 0 && (si >= 0 || ni >= 0)) {
      headerLineIdx = h;
      latIdx = li;
      lonIdx = lo;
      siteIdx = si >= 0 ? si : ni;
      nameIdx = ni >= 0 ? ni : si;
      elevIdx = ei;
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
      sites.push({
        site,
        latitude: lat,
        longitude: lon,
        elevation: !isNaN(elev as number) ? elev : undefined,
        name: name || site,
      });
    }
  }
  return sites;
}

/**
 * Fetch African AERONET sites using the official site list text file.
 * Uses aeronet_locations_extended_v3.txt (not the deprecated print_site_table_v3).
 */
export async function getAfricanAERONETSites(): Promise<AERONETSite[]> {
  try {
    const url = `${API_BASE}/aeronet_locations_extended_v3.txt`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`AERONET API ${res.status}`);
    const text = await res.text();
    const all = parseLocationsText(text);
    return all.filter((s) => s.latitude >= -37 && s.latitude <= 37 && s.longitude >= -18 && s.longitude <= 52);
  } catch (err) {
    console.error('[AERONET] Error:', err);
    return [];
  }
}

/**
 * Fetch AOD time series for a site using print_web_data_v3
 * @param site AERONET site code
 * @param startDate YYYY-MM-DD
 * @param endDate YYYY-MM-DD
 */
export async function getAERONETData(
  site: string,
  startDate: string,
  endDate: string
): Promise<AERONETDataPoint[]> {
  try {
    const [y1, m1, d1] = startDate.split('-').map(Number);
    const [y2, m2, d2] = endDate.split('-').map(Number);
    const params = new URLSearchParams({
      site,
      year: String(y1),
      month: String(m1).padStart(2, '0'),
      day: String(d1).padStart(2, '0'),
      year2: String(y2),
      month2: String(m2).padStart(2, '0'),
      day2: String(d2).padStart(2, '0'),
      AOD15: '1',
      AVG: '20',
      if_no_html: '1',
    });
    const url = `${API_BASE}/cgi-bin/print_web_data_v3?${params}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const text = await res.text();
    const lines = text.split('\n').filter((l) => l.trim());
    if (lines.length < 2) return [];

    let headerLineIdx = 0;
    for (let h = 0; h < Math.min(10, lines.length); h++) {
      const row = lines[h];
      const hasDate = row.includes('Date') && !row.includes('End_Date');
      const hasAod = /aod|aot/i.test(row) && /500|675|870|1020/.test(row);
      if (hasDate && (hasAod || row.split(',').length > 5)) {
        headerLineIdx = h;
        break;
      }
    }
    const header = lines[headerLineIdx];
    const colsArr = header.split(',');
    const dateIdx = colsArr.findIndex((c) => c.includes('Date') && !c.includes('End'));
    const timeIdx = colsArr.findIndex((c) => c.toLowerCase().includes('time') && !c.includes('datetime'));
    const doyIdx = colsArr.findIndex((c) => /day_of_year|dayofyear/i.test(c));
    const findAod = (w: string) =>
      colsArr.findIndex((c) => (/aod|aot/i.test(c)) && c.includes(w));
    const aod500Idx = findAod('500');
    const aod675Idx = findAod('675');
    const aod870Idx = findAod('870');
    const aod1020Idx = findAod('1020');

    const points: AERONETDataPoint[] = [];
    for (let i = headerLineIdx + 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      const date = dateIdx >= 0 ? cols[dateIdx]?.trim() : cols[0]?.trim() || '';
      if (!date || date.startsWith(';') || date === 'AERONET') continue;
      const time = timeIdx >= 0 ? cols[timeIdx]?.trim() : undefined;
      const doy = doyIdx >= 0 ? parseInt(cols[doyIdx], 10) : undefined;
      const toAod = (v: number | undefined) =>
        v == null || isNaN(v) || v < -900 ? undefined : v;
      const aod500 = aod500Idx >= 0 ? parseFloat(cols[aod500Idx]) : undefined;
      const aod675 = aod675Idx >= 0 ? parseFloat(cols[aod675Idx]) : undefined;
      const aod870 = aod870Idx >= 0 ? parseFloat(cols[aod870Idx]) : undefined;
      const aod1020 = aod1020Idx >= 0 ? parseFloat(cols[aod1020Idx]) : undefined;
      points.push({
        date,
        time: time || undefined,
        dayOfYear: !isNaN(doy as number) ? doy : undefined,
        AOD_500nm: toAod(aod500 as number),
        AOD_675nm: toAod(aod675 as number),
        AOD_870nm: toAod(aod870 as number),
        AOD_1020nm: toAod(aod1020 as number),
      });
    }
    return points;
  } catch (err) {
    console.error('[AERONET] getAERONETData error:', err);
    return [];
  }
}

/** Africa bounding box */
const AFRICA_BBOX = { south: -37, west: -18, north: 37, east: 52 };

/**
 * Fetch AOD data for all African sites in date range. Used to color-code map markers.
 * Returns map of site ID -> latest AOD 500nm (or hasData: false).
 */
export async function getAERONETDataAfrica(
  startDate: string,
  endDate: string
): Promise<SiteAODMap> {
  const map: SiteAODMap = {};
  try {
    const [y1, m1, d1] = startDate.split('-').map(Number);
    const [y2, m2, d2] = endDate.split('-').map(Number);
    const params = new URLSearchParams({
      year: String(y1),
      month: String(m1).padStart(2, '0'),
      day: String(d1).padStart(2, '0'),
      year2: String(y2),
      month2: String(m2).padStart(2, '0'),
      day2: String(d2).padStart(2, '0'),
      lat1: String(AFRICA_BBOX.south),
      lon1: String(AFRICA_BBOX.west),
      lat2: String(AFRICA_BBOX.north),
      lon2: String(AFRICA_BBOX.east),
      AOD15: '1',
      AVG: '20',
      if_no_html: '1',
    });
    const url = `${API_BASE}/cgi-bin/print_web_data_v3?${params}`;
    const res = await fetch(url);
    if (!res.ok) return map;
    const text = await res.text();
    const lines = text.split('\n').filter((l) => l.trim());
    if (lines.length < 2) return map;

    let headerLineIdx = 0;
    for (let h = 0; h < Math.min(10, lines.length); h++) {
      const row = lines[h];
      const hasDate = row.includes('Date') && !row.includes('End_Date');
      const hasSite = /site/i.test(row) && !row.includes('datetime');
      const hasAod = /aod|aot/i.test(row) && /500|675|870|1020/.test(row);
      if (hasDate && (hasSite || hasAod || row.split(',').length > 5)) {
        headerLineIdx = h;
        break;
      }
    }
    const header = lines[headerLineIdx];
    const colsArr = header.split(',');
    const siteIdx = colsArr.findIndex((c) => c.toLowerCase().includes('site') && !c.includes('datetime'));
    const findAod = (w: string) =>
      colsArr.findIndex((c) => (/aod|aot/i.test(c)) && c.includes(w));
    const aod500Idx = findAod('500');
    const aod675Idx = findAod('675');
    const aod870Idx = findAod('870');
    const aod1020Idx = findAod('1020');
    if (siteIdx < 0) return map;

    const toAod = (v: number) => (v == null || isNaN(v) || v < -900 ? NaN : v);
    for (let i = headerLineIdx + 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      const site = cols[siteIdx]?.trim();
      if (!site || site.startsWith(';') || site === 'AERONET') continue;
      const aod500 = toAod(aod500Idx >= 0 ? parseFloat(cols[aod500Idx]) : NaN);
      const aod675 = toAod(aod675Idx >= 0 ? parseFloat(cols[aod675Idx]) : NaN);
      const aod870 = toAod(aod870Idx >= 0 ? parseFloat(cols[aod870Idx]) : NaN);
      const aod1020 = toAod(aod1020Idx >= 0 ? parseFloat(cols[aod1020Idx]) : NaN);
      if (isNaN(aod500) && isNaN(aod675) && isNaN(aod870) && isNaN(aod1020)) continue;
      map[site] = {
        hasData: true,
        AOD_500nm: !isNaN(aod500) ? aod500 : undefined,
        AOD_675nm: !isNaN(aod675) ? aod675 : undefined,
        AOD_870nm: !isNaN(aod870) ? aod870 : undefined,
        AOD_1020nm: !isNaN(aod1020) ? aod1020 : undefined,
      };
    }
    return map;
  } catch (err) {
    console.error('[AERONET] getAERONETDataAfrica error:', err);
    return map;
  }
}
