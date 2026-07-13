/**
 * AAQE / HAQAST project copy — sourced from project About materials.
 * HomePage and other views can import sections as needed.
 */

export const AAQE_PROJECT_TITLE = 'African Air Quality Explorer';

export const AAQE_PROJECT_TAGLINE =
  'African Air Quality Explorer Powered by NASA Data and Research is a NASA HAQAST project led by Dr. Pawan Gupta in partnership with the U.S. Department of State. The project is designed to integrate NASA satellite observations, model outputs, ground measurements, and applied research into an accessible air-quality monitoring, analysis, and forecasting platform for African countries and cities.';

export const AAQE_PROJECT_MOTIVATION = `Many African countries face severe air-quality challenges from urban emissions, biomass burning, Saharan dust, industrial activity, transportation, and waste burning, while reliable ground monitoring remains limited in many regions. The AAQE project addresses this gap by providing a trusted, open, and user-friendly platform that makes NASA data easier to interpret and apply for research, public communication, capacity building, and decision support.`;

export const AAQE_PRIMARY_GOALS = [
  'Develop and deploy the African Air Quality Explorer as an online visualization and analytical tool.',
  'Support African air-quality monitoring, forecasting, and exposure-related research using NASA data and research products.',
  'Enable users to explore air-quality patterns from continental overview to country, city, station, and selected map-point scales.',
  'Provide downloadable time series and gridded outputs for offline analysis and stakeholder use.',
];

export const AAQE_STAKEHOLDER_ROLE = [
  'Support U.S. Department of State environmental diplomacy and air-quality capacity-building efforts in Africa.',
  'Engage governmental, public, academic, and local partner organizations through training and workshops.',
  'Help users access trusted air-quality information without requiring each organization to build its own satellite-data processing tools.',
  'Strengthen local technical capacity for interpreting satellite, model, and ground-based air-quality datasets.',
];

export const AAQE_SCIENCE_FOCUS = [
  'Focus on particle pollution, especially PM2.5 and atmospheric aerosols.',
  'Represent major aerosol events such as dust, fire/smoke, regional haze, and urban pollution episodes.',
  'Support historical analysis, near-real-time event monitoring, and forecast interpretation.',
  'Link satellite imagery, AOD, fire activity, PM2.5, and station-based observations in one workflow.',
];

export const AAQE_HISTORICAL_DATASETS = [
  'MERRA2 PM2.5 and MERRA2-CNN / ML bias-corrected PM2.5.',
  'Monthly and annual high-resolution satellite-informed PM2.5 products.',
  'City and country time series at hourly, daily, monthly, and yearly time scales.',
  'Comparison with station PM2.5 and AERONET-style AOD where available.',
];

export const AAQE_NRT_LAYERS = [
  'VIIRS true-color imagery for visual context on dust, smoke, haze, and clouds.',
  'Satellite AOD layers to support aerosol event interpretation.',
  'Fire-hotspot overlays for identifying active fire and smoke-source regions.',
  'Ground-network context from AERONET, OpenAQ, AirQo, and related monitoring efforts.',
];

export const AAQE_FORECAST_AND_ACCESS = [
  'Forward-looking PM2.5 forecast information for selected African cities and regions.',
  'Interactive plots for time series, city comparison, AOD-PM2.5 relationships, station context, and forecast summaries.',
  'Expandable product metadata to communicate source, resolution, update frequency, and appropriate use.',
  'Download tools for map-layer values, selected time series, station context, and synthetic dashboard demonstration data.',
];

export const AAQE_DASHBOARD_DESIGN = `The dashboard is organized to follow the intended AAQE user workflow. Users start with an Africa-wide map overview, select a historical, near-real-time, or forecast workflow, choose the relevant product, and then drill down to a country, city, station, or clicked map point. The goal is to make NASA air-quality information easier to explore, compare, explain, and download for research colleagues, decision makers, and partner organizations.`;
