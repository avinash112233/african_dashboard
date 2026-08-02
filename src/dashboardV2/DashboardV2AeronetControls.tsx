import type { AERONETSite, AERONETAODVersion } from '../services/aeronetApi';

interface DashboardV2AeronetControlsProps {
  showAeronet: boolean;
  aeronetLoading: boolean;
  aeronetError: string | null;
  visibleSites: AERONETSite[];
  showAeronetStations: boolean;
  onShowAeronetStationsChange: (value: boolean) => void;
  aeronetAodVersion: AERONETAODVersion;
  onAeronetAodVersionChange: (version: AERONETAODVersion) => void;
  selectedSiteId: string;
  onSiteSelect: (site: AERONETSite | null) => void;
  isPointOnlyHeat: boolean;
}

const DashboardV2AeronetControls = ({
  showAeronet,
  aeronetLoading,
  aeronetError,
  visibleSites,
  showAeronetStations,
  onShowAeronetStationsChange,
  aeronetAodVersion,
  onAeronetAodVersionChange,
  selectedSiteId,
  onSiteSelect,
  isPointOnlyHeat,
}: DashboardV2AeronetControlsProps) => {
  if (!showAeronet) return null;

  return (
    <div className="dashboard-v2-aeronet-controls">
      {isPointOnlyHeat && (
        <div className="mini-note mb-2">
          AERONET is a point-station product. Stations are colored by AOD for the map / valid date; there
          is no gridded heat map.
        </div>
      )}

      <label className="form-label" htmlFor="v2-aeronet-aod-version">
        AOD version
      </label>
      <select
        id="v2-aeronet-aod-version"
        className="form-select mb-2"
        value={String(aeronetAodVersion)}
        onChange={(e) => onAeronetAodVersionChange(Number(e.target.value) as AERONETAODVersion)}
      >
        <option value="1">1.0 (AOD10)</option>
        <option value="1.5">1.5 (AOD15)</option>
        <option value="2">2.0 (AOD20)</option>
      </select>

      {aeronetLoading && (
        <span className="v2-loading-pill mb-2">
          <i className="bi bi-arrow-repeat" aria-hidden="true" /> Loading AERONET sites…
        </span>
      )}
      {aeronetError && <p className="v2-error-note">{aeronetError}</p>}

      {visibleSites.length > 0 && (
        <>
          <label className="form-label" htmlFor="v2-aeronet-site">
            AERONET site
          </label>
          <select
            id="v2-aeronet-site"
            className="form-select mb-2"
            value={selectedSiteId}
            onChange={(e) => {
              const site = visibleSites.find((s) => s.site === e.target.value);
              onSiteSelect(site ?? null);
            }}
          >
            <option value="">Select a site…</option>
            {visibleSites.map((site) => (
              <option key={site.site} value={site.site}>
                {site.name ?? site.site}
              </option>
            ))}
          </select>
        </>
      )}

      <hr className="dashboard-v2-panel-divider" />

      <div className="toggle-grid">
        <div className="form-check form-switch">
          <input
            className="form-check-input"
            type="checkbox"
            id="v2-aeronet-stations"
            checked={showAeronetStations}
            onChange={(e) => onShowAeronetStationsChange(e.target.checked)}
          />
          <label className="form-check-label" htmlFor="v2-aeronet-stations">
            Observed stations
          </label>
        </div>
      </div>
    </div>
  );
};

export default DashboardV2AeronetControls;
