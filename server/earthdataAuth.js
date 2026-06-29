/** Earthdata Login bearer token for GES DISC / OPeNDAP (Basic auth on data URLs returns 401). */

let cachedToken = null;
let cachedTokenExpiryMs = 0;

export function clearEarthdataTokenCache() {
  cachedToken = null;
  cachedTokenExpiryMs = 0;
}

export function trimEnv(value) {
  if (value == null || value === '') return '';
  let v = String(value).trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1).trim();
  }
  return v;
}

export function getEarthdataAuthStatus() {
  const username = trimEnv(process.env.EARTHDATA_USERNAME);
  const password = trimEnv(process.env.EARTHDATA_PASSWORD);
  const token = trimEnv(process.env.EARTHDATA_TOKEN);
  if (username && password) return { mode: 'username_password', ready: true };
  if (token) return { mode: 'token', ready: true };
  return { mode: 'none', ready: false };
}

async function fetchTokenFromCredentials() {
  const username = trimEnv(process.env.EARTHDATA_USERNAME);
  const password = trimEnv(process.env.EARTHDATA_PASSWORD);
  if (!username || !password) return null;

  const credentials = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
  let res;
  try {
    res = await fetch('https://urs.earthdata.nasa.gov/api/users/find_or_create_token', {
      method: 'POST',
      headers: { Authorization: `Basic ${credentials}` },
    });
  } catch (e) {
    console.warn('[Earthdata] Token request network error:', e.message);
    return null;
  }

  if (!res.ok) {
    console.warn('[Earthdata] Token request failed:', res.status, res.statusText);
    return null;
  }

  let data;
  try {
    data = await res.json();
  } catch {
    console.warn('[Earthdata] Token response was not JSON');
    return null;
  }

  return data?.access_token ?? null;
}

/**
 * Returns a Bearer token: fresh token from username/password (preferred), cached token,
 * static EARTHDATA_TOKEN, or null.
 * @see https://urs.earthdata.nasa.gov/documentation/for_users/user_token
 */
export async function getEarthdataBearerToken({ forceRefresh = false } = {}) {
  if (forceRefresh) clearEarthdataTokenCache();

  if (!forceRefresh && cachedToken && Date.now() < cachedTokenExpiryMs) {
    return cachedToken;
  }

  // Prefer live token from credentials — static EARTHDATA_TOKEN in .env is often expired.
  const username = trimEnv(process.env.EARTHDATA_USERNAME);
  const password = trimEnv(process.env.EARTHDATA_PASSWORD);
  if (username && password) {
    const accessToken = await fetchTokenFromCredentials();
    if (accessToken) {
      cachedToken = accessToken;
      cachedTokenExpiryMs = Date.now() + 30 * 24 * 60 * 60 * 1000;
      return accessToken;
    }
  }

  const directToken = trimEnv(process.env.EARTHDATA_TOKEN);
  if (directToken) return directToken;

  return null;
}
