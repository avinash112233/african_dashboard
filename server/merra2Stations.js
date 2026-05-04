import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const workerScript = path.join(
  __dirname,
  'merra2StationsWorker.py'
);

async function runWorker(args) {
  try {
    const { stdout } = await execFileAsync('python', [workerScript, ...args], {
      env: process.env,
      maxBuffer: 20 * 1024 * 1024,
    });
    return JSON.parse(stdout);
  } catch (err) {
    const stderr = err?.stderr?.toString?.().trim();
    const stdout = err?.stdout?.toString?.().trim();
    const payload = stdout ? safeJson(stdout) : null;
    const message = payload?.error || stderr || err?.message || 'Unexpected MERRA2 station API error.';
    const code = Number(err?.code);
    const status = mapWorkerExitCodeToHttpStatus(code, message);
    throw new HttpError(status, message);
  }
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function mapWorkerExitCodeToHttpStatus(code, message) {
  if (!Number.isFinite(code)) return 500;
  if (code === 2) return 400;
  if (code === 4 || code === 6) return 404;
  if (/Invalid\s/.test(message)) return 400;
  return 500;
}

export async function getStationsForDate(dateStr) {
  const out = await runWorker(['stations', '--date', dateStr]);
  return out?.stations ?? [];
}

export async function getStationTimeseries({ sitename, start, end }) {
  return runWorker([
    'station-timeseries',
    '--sitename',
    String(sitename ?? ''),
    '--start',
    String(start ?? ''),
    '--end',
    String(end ?? ''),
  ]);
}

export async function getStationList() {
  const out = await runWorker(['station-list']);
  return out?.stations ?? [];
}

export async function getLatestStationDate() {
  return runWorker(['latest-date']);
}

export function toHttpError(err) {
  if (err?.status) return err;
  if (typeof err === 'string') return new HttpError(500, err);
  return new HttpError(500, err?.message || 'Unexpected MERRA2 station API error.');
}

