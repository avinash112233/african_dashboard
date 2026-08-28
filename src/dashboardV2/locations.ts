export interface DashboardV2Location {
  id: string;
  label: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
  zoom: number;
}

export interface DashboardV2MapFlyTo {
  lat: number;
  lon: number;
  zoom: number;
  key: number;
}

export const AFRICA_OVERVIEW_LOCATION: DashboardV2Location = {
  id: 'africa-overview',
  label: 'Africa overview',
  city: '— select country first —',
  country: 'Africa overview',
  lat: 5,
  lon: 20,
  zoom: 4,
};

/** Curated cities aligned with Dashboard V2 country/city dropdowns. */
export const DASHBOARD_V2_LOCATIONS: DashboardV2Location[] = [
  AFRICA_OVERVIEW_LOCATION,
  {
    id: 'lagos',
    label: 'Lagos, Nigeria',
    city: 'Lagos, Nigeria',
    country: 'Nigeria',
    lat: 6.5244,
    lon: 3.3792,
    zoom: 11,
  },
  {
    id: 'abuja',
    label: 'Abuja, Nigeria',
    city: 'Abuja, Nigeria',
    country: 'Nigeria',
    lat: 9.0765,
    lon: 7.3986,
    zoom: 11,
  },
  {
    id: 'kano',
    label: 'Kano, Nigeria',
    city: 'Kano, Nigeria',
    country: 'Nigeria',
    lat: 12.0022,
    lon: 8.592,
    zoom: 11,
  },
  {
    id: 'accra',
    label: 'Accra, Ghana',
    city: 'Accra, Ghana',
    country: 'Ghana',
    lat: 5.6037,
    lon: -0.187,
    zoom: 11,
  },
  {
    id: 'kumasi',
    label: 'Kumasi, Ghana',
    city: 'Kumasi, Ghana',
    country: 'Ghana',
    lat: 6.6885,
    lon: -1.6244,
    zoom: 11,
  },
  {
    id: 'kampala',
    label: 'Kampala, Uganda',
    city: 'Kampala, Uganda',
    country: 'Uganda',
    lat: 0.3476,
    lon: 32.5825,
    zoom: 11,
  },
  {
    id: 'gulu',
    label: 'Gulu, Uganda',
    city: 'Gulu, Uganda',
    country: 'Uganda',
    lat: 2.7747,
    lon: 32.298,
    zoom: 11,
  },
  {
    id: 'kigali',
    label: 'Kigali, Rwanda',
    city: 'Kigali, Rwanda',
    country: 'Rwanda',
    lat: -1.9706,
    lon: 30.1044,
    zoom: 12,
  },
  {
    id: 'nairobi',
    label: 'Nairobi, Kenya',
    city: 'Nairobi, Kenya',
    country: 'Kenya',
    lat: -1.2921,
    lon: 36.8219,
    zoom: 11,
  },
  {
    id: 'johannesburg',
    label: 'Johannesburg, South Africa',
    city: 'Johannesburg, South Africa',
    country: 'South Africa',
    lat: -26.2041,
    lon: 28.0473,
    zoom: 11,
  },
  {
    id: 'cape-town',
    label: 'Cape Town, South Africa',
    city: 'Cape Town, South Africa',
    country: 'South Africa',
    lat: -33.9249,
    lon: 18.4241,
    zoom: 11,
  },
  {
    id: 'addis-ababa',
    label: 'Addis Ababa, Ethiopia',
    city: 'Addis Ababa, Ethiopia',
    country: 'Ethiopia',
    lat: 9.032,
    lon: 38.7469,
    zoom: 11,
  },
  {
    id: 'dakar',
    label: 'Dakar, Senegal',
    city: 'Dakar, Senegal',
    country: 'Senegal',
    lat: 14.7167,
    lon: -17.4677,
    zoom: 11,
  },
];

export function findLocationByLabel(label: string): DashboardV2Location | undefined {
  const normalized = label.trim();
  if (!normalized || normalized.startsWith('—')) return undefined;
  return DASHBOARD_V2_LOCATIONS.find(
    (loc) => loc.label === normalized || loc.city === normalized
  );
}

export function filterLocations(query: string): DashboardV2Location[] {
  const q = query.trim().toLowerCase();
  if (!q) return DASHBOARD_V2_LOCATIONS;
  return DASHBOARD_V2_LOCATIONS.filter(
    (loc) =>
      loc.label.toLowerCase().includes(q) ||
      loc.country.toLowerCase().includes(q) ||
      loc.city.toLowerCase().includes(q)
  );
}

export function toMapFlyTo(loc: DashboardV2Location, key = Date.now()): DashboardV2MapFlyTo {
  return { lat: loc.lat, lon: loc.lon, zoom: loc.zoom, key };
}
