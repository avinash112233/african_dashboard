import { africaNativeBounds } from '../utils/merra2GridGeometry';

export interface Merra2DailyCube {
  date: string;
  hours: number;
  units: string;
  bounds: { south: number; west: number; north: number; east: number };
  width: number;
  height: number;
  noDataValue: number;
  hourMin: number[];
  hourMax: number[];
  values: number[];
  source: 'gesdisc' | 'sample';
  fallbackReason?: string;
}

export interface Merra2HourGrid {
  date: string;
  hour: number;
  units: string;
  bounds: { south: number; west: number; north: number; east: number };
  width: number;
  height: number;
  noDataValue: number;
  min: number;
  max: number;
  values: number[];
  source: 'gesdisc' | 'sample';
}

const DB_NAME = 'african-dashboard-merra2';
const DB_VERSION = 3;
const STORE = 'daily-cubes';
/** Bump when backend cube extraction changes — skips stale sample entries from older builds. */
const CUBE_CACHE_SCHEMA = 'netcdf-v1';

const memoryCache = new Map<string, Merra2DailyCube>();
const inflight = new Map<string, Promise<Merra2DailyCube>>();

function buildBaseApiUrl(path: string) {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '') || '';
  return `${base}${path}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE);
      db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

async function readCubeFromIdb(date: string): Promise<Merra2DailyCube | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(date);
      req.onsuccess = () => resolve((req.result as Merra2DailyCube) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function writeCubeToIdb(cube: Merra2DailyCube): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(cube, cube.date);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore quota / private mode */
  }
}

interface Merra2CubeBinHeader {
  date: string;
  hours: number;
  units: string;
  bounds: { south: number; west: number; north: number; east: number };
  width: number;
  height: number;
  noDataValue: number;
  hourMin: number[];
  hourMax: number[];
  source: 'gesdisc' | 'sample';
  fallbackReason?: string;
  scale: number;
  noDataCode: number;
}

/**
 * Decode the compact wire format from /api/merra2/pm25/daily-cube.bin:
 * [u32 LE headerLen][headerLen bytes UTF-8 JSON, even-padded][Int16 LE quantized values].
 * This is a fraction of the size of the equivalent JSON (~100-150KB vs ~570KB gzipped),
 * which matters because this payload is served straight from our backend (EC2 egress),
 * not cached by any CDN.
 */
function decodeDailyCubeBinary(buffer: ArrayBuffer): Merra2DailyCube {
  const headerLenView = new DataView(buffer, 0, 4);
  const headerLen = headerLenView.getUint32(0, true);
  const headerBytes = new Uint8Array(buffer, 4, headerLen);
  const header = JSON.parse(new TextDecoder('utf-8').decode(headerBytes)) as Merra2CubeBinHeader;

  const bodyOffset = 4 + headerLen;
  const cellCount = header.width * header.height * header.hours;
  const codes = new Int16Array(buffer, bodyOffset, cellCount);
  const scale = header.scale || 10;
  const noDataCode = header.noDataCode ?? -32768;

  const values = new Array<number>(cellCount);
  for (let i = 0; i < cellCount; i++) {
    const code = codes[i];
    values[i] = code === noDataCode ? header.noDataValue : code / scale;
  }

  return {
    date: header.date,
    hours: header.hours,
    units: header.units,
    bounds: header.bounds ?? africaNativeBounds(),
    width: header.width,
    height: header.height,
    noDataValue: header.noDataValue,
    hourMin: header.hourMin,
    hourMax: header.hourMax,
    values,
    source: header.source,
    fallbackReason: header.fallbackReason,
  };
}

async function fetchDailyCubeFromApi(date: string): Promise<Merra2DailyCube> {
  const params = new URLSearchParams({ date, v: CUBE_CACHE_SCHEMA });
  const url = buildBaseApiUrl(`/api/merra2/pm25/daily-cube.bin?${params.toString()}`);
  const res = await fetch(url);
  if (!res.ok) {
    let message = `Daily cube request failed (${res.status})`;
    try {
      const json = (await res.json()) as { error?: string };
      if (json.error) message = json.error;
    } catch {
      /* keep generic */
    }
    throw new Error(message);
  }
  const buffer = await res.arrayBuffer();
  return decodeDailyCubeBinary(buffer);
}

function isPersistableCube(cube: Merra2DailyCube): boolean {
  return cube.source === 'gesdisc';
}

export async function loadMerra2DailyCube(date: string): Promise<Merra2DailyCube> {
  const cached = memoryCache.get(date);
  if (cached && isPersistableCube(cached)) return cached;

  const idbHit = await readCubeFromIdb(date);
  if (idbHit && isPersistableCube(idbHit)) {
    memoryCache.set(date, idbHit);
    return idbHit;
  }

  const pending = inflight.get(date);
  if (pending) return pending;

  const promise = fetchDailyCubeFromApi(date)
    .then(async (cube) => {
      memoryCache.set(date, cube);
      if (isPersistableCube(cube)) {
        await writeCubeToIdb(cube);
      }
      return cube;
    })
    .finally(() => inflight.delete(date));

  inflight.set(date, promise);
  return promise;
}

export function hourGridFromCube(cube: Merra2DailyCube, hour: number): Merra2HourGrid {
  const h = Math.max(0, Math.min(cube.hours - 1, Math.floor(hour)));
  const sliceLen = cube.width * cube.height;
  const offset = h * sliceLen;
  return {
    date: cube.date,
    hour: h,
    units: cube.units,
    bounds: cube.bounds,
    width: cube.width,
    height: cube.height,
    noDataValue: cube.noDataValue,
    min: cube.hourMin[h] ?? 0,
    max: cube.hourMax[h] ?? 50,
    values: cube.values.slice(offset, offset + sliceLen),
    source: cube.source,
  };
}
