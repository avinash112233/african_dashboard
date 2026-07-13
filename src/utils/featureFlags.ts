/** Dashboard 2 preview — set VITE_ENABLE_DASHBOARD_V2=true in local .env only. */
export function isDashboardV2Enabled(): boolean {
  return import.meta.env.VITE_ENABLE_DASHBOARD_V2 === 'true';
}
