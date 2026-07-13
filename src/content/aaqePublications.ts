/**
 * AAQE related publications — sourced from project publication list.
 */

export interface AaqePublication {
  id: number;
  authors: string;
  title: string;
  journal: string;
  year: number;
  doi: string;
}

export const AAQE_PUBLICATIONS: AaqePublication[] = [
  {
    id: 1,
    authors: 'J. Seo and P. Gupta',
    title:
      'Adaptive expert-guided deep imbalanced regression for global PM2.5 forecasting with temporal convolutional networks and GEOS-FP inputs',
    journal: 'npj Climate and Atmospheric Science',
    year: 2026,
    doi: '10.1038/s41612-026-01437-1',
  },
  {
    id: 2,
    authors: 'Z. Dong et al.',
    title:
      'Machine learning bias correction of HRRR-Smoke surface PM2.5 forecasts during the Alaska wildfire season',
    journal: 'ACS ES&T Air',
    year: 2026,
    doi: '10.1021/acsestair.5c00409',
  },
  {
    id: 3,
    authors: 'P. Gupta and A. Sayeed',
    title:
      'MERRA2_CNN_HAQAST_PM25: Hourly bias-corrected PM2.5 datasets for global air quality assessment',
    journal: 'Geoscience Data Journal',
    year: 2026,
    doi: '10.1002/gdj3.70070',
  },
  {
    id: 4,
    authors: 'P. Gupta',
    title:
      'MERRA2_CNN_HAQAST bias corrected global hourly surface total PM2.5 mass concentration, V1',
    journal: 'NASA Goddard Earth Sciences Data and Information Services Center',
    year: 2023,
    doi: '10.5067/OCKK5HCFW5N3',
  },
  {
    id: 5,
    authors: 'K. Gui et al.',
    title: 'Advancing operational global aerosol forecasting with machine learning',
    journal: 'Nature',
    year: 2026,
    doi: '10.1038/s41586-026-10234-y',
  },
  {
    id: 6,
    authors: 'S. Park, A. Sayeed, J. Seo, B. H. Henderson, A. R. Naeger, and P. Gupta',
    title: 'Hour by hour PM2.5 mapping using geostationary satellites',
    journal: 'ACS ES&T Air',
    year: 2025,
    doi: '10.1021/acsestair.4c00365',
  },
  {
    id: 7,
    authors: 'J. Seo et al.',
    title:
      'PM2.5 forecasting at U.S. embassies and consulates worldwide using NASA model powered by machine learning',
    journal: 'Earth and Space Science',
    year: 2025,
    doi: '10.1029/2025EA004210',
  },
  {
    id: 8,
    authors: 'A. Sayeed, P. Gupta, B. Henderson, S. Kondragunta, H. Zhang, and Y. Liu',
    title: 'GOES-R PM2.5 evaluation and bias correction: A deep learning approach',
    journal: 'Earth and Space Science',
    year: 2025,
    doi: '10.1029/2024EA004012',
  },
  {
    id: 9,
    authors: 'P. Gupta et al.',
    title:
      'Increasing aerosol optical depth spatial and temporal availability by merging datasets from geostationary and sun-synchronous satellites',
    journal: 'Atmospheric Measurement Techniques',
    year: 2024,
    doi: '10.5194/amt-17-5455-2024',
  },
  {
    id: 10,
    authors: 'M. Kim, R. C. Levy, L. A. Remer, S. Mattoo, and P. Gupta',
    title:
      'Parameterizing spectral surface reflectance relationships for the Dark Target aerosol algorithm applied to a geostationary imager',
    journal: 'Atmospheric Measurement Techniques',
    year: 2024,
    doi: '10.5194/amt-17-1913-2024',
  },
  {
    id: 11,
    authors: 'T. Zhao, J. Mao, P. Gupta, H. Zhang, and J. Wang',
    title:
      'Observational constraints on the aerosol optical depth-surface PM2.5 relationship during Alaskan wildfire seasons',
    journal: 'ACS ES&T Air',
    year: 2024,
    doi: '10.1021/acsestair.4c00120',
  },
  {
    id: 12,
    authors: 'X. Zhang et al.',
    title:
      'Aerosol components derived from global AERONET measurements by GRASP: A new value-added aerosol component global dataset and its application',
    journal: 'Bulletin of the American Meteorological Society',
    year: 2024,
    doi: '10.1175/BAMS-D-23-0260.1',
  },
  {
    id: 13,
    authors: 'J. Liu et al.',
    title:
      'New top-down estimation of daily mass and number column density of black carbon driven by OMI and AERONET observations',
    journal: 'Remote Sensing of Environment',
    year: 2024,
    doi: '10.1016/j.rse.2024.114436',
  },
  {
    id: 14,
    authors: 'A. Sayeed, P. Lin, P. Gupta, N. N. M. Tran, V. Buchard, and S. Christopher',
    title: 'Hourly and daily PM2.5 estimations using MERRA-2: A machine learning approach',
    journal: 'Earth and Space Science',
    year: 2022,
    doi: '10.1029/2022EA002375',
  },
  {
    id: 15,
    authors: 'P. Gupta et al.',
    title: 'Machine learning algorithm for estimating surface PM2.5 in Thailand',
    journal: 'Aerosol and Air Quality Research',
    year: 2021,
    doi: '10.4209/aaqr.210105',
  },
  {
    id: 16,
    authors:
      'J. M. Carmona, P. Gupta, D. F. Lozano-Garcia, A. Y. Vanoye, I. Y. Hernandez-Paniagua, and A. Mendoza',
    title:
      'Evaluation of MODIS aerosol optical depth and surface data using an ensemble modeling approach to assess PM2.5 temporal and spatial distributions',
    journal: 'Remote Sensing',
    year: 2021,
    doi: '10.3390/rs13163102',
  },
  {
    id: 17,
    authors: 'Z. Xue, P. Gupta, and S. A. Christopher',
    title:
      'Satellite-based estimation of the impacts of summertime wildfires on PM2.5 concentration in the United States',
    journal: 'Atmospheric Chemistry and Physics',
    year: 2021,
    doi: '10.5194/acp-21-11243-2021',
  },
  {
    id: 18,
    authors: 'P. Gupta, L. A. Remer, F. Patadia, R. C. Levy, and S. A. Christopher',
    title: 'High-resolution gridded Level 3 aerosol optical depth data from MODIS',
    journal: 'Remote Sensing',
    year: 2020,
    doi: '10.3390/rs12172847',
  },
  {
    id: 19,
    authors:
      'P. Gupta, R. C. Levy, S. Mattoo, L. A. Remer, R. E. Holz, and A. K. Heidinger',
    title:
      'Applying the Dark Target aerosol algorithm with Advanced Himawari Imager observations during the KORUS-AQ field campaign',
    journal: 'Atmospheric Measurement Techniques',
    year: 2019,
    doi: '10.5194/amt-12-6557-2019',
  },
  {
    id: 20,
    authors: 'P. Gupta et al.',
    title:
      'Impact of California fires on local and regional air quality: The role of a low-cost sensor network and satellite observations',
    journal: 'GeoHealth',
    year: 2018,
    doi: '10.1029/2018GH000136',
  },
  {
    id: 21,
    authors: 'P. Gupta, R. C. Levy, S. Mattoo, L. A. Remer, and L. A. Munchak',
    title:
      'A surface reflectance scheme for retrieving aerosol optical depth over urban surfaces in MODIS Dark Target retrieval algorithm',
    journal: 'Atmospheric Measurement Techniques',
    year: 2016,
    doi: '10.5194/amt-9-3293-2016',
  },
];
