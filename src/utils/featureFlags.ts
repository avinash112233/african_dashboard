/** Dashboard V2 available (preview at /dashboard-2, or sole dashboard when V2-only). */
export function isDashboardV2Enabled(): boolean {
  return (
    import.meta.env.VITE_ENABLE_DASHBOARD_V2 === 'true' ||
    import.meta.env.VITE_DASHBOARD_V2_ONLY === 'true'
  );
}

/** Production: V2 only at /dashboard — hide V1 and the "Dashboard 2" nav link. */
export function isDashboardV2Only(): boolean {
  return import.meta.env.VITE_DASHBOARD_V2_ONLY === 'true';
}
