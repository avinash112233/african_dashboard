# African Aerosol Dashboard

A comprehensive web application for aerosol monitoring and data visualization in Africa.

## Features

- **Data Visualization**
  - Interactive maps with point locations
  - Heat maps for density analysis
  - Satellite image display layers
  - Timeseries analysis
  - Scatter plots
  - Bar charts

- **Data Download**
  - Select datasets and parameters
  - CSV format export
  - NetCDF format support (requires backend)

- **Research Publications**
  - Browse publications related to aerosol research in Africa

- **Project Information**
  - Home page with project overview
  - Team page with researcher information

## Tech Stack

- React 19 with TypeScript
- Vite for build tooling
- Leaflet for maps
- Chart.js for data visualization
- Material-UI and Bootstrap for UI components
- React Router for navigation

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

The application will be available at `http://localhost:5173`

### Build for Production

```bash
npm run build
```

### Preview Production Build

```bash
npm run preview
```

## Project Structure

```
src/
├── components/       # Reusable components
│   ├── charts/      # Chart components (timeseries, scatter, bar)
│   ├── maps/        # Map visualization components
│   ├── dataDownload/# Data download components
│   ├── layout/      # Layout components (navigation, etc.)
│   └── common/      # Common/shared components
├── pages/           # Page components
├── services/        # API services
├── types/           # TypeScript type definitions
├── utils/           # Utility functions
└── config/          # Configuration files
```

## Configuration

### Base Path

The application is configured to run under `/new_web/african_dashboard` base path. This can be changed in:
- `vite.config.ts` - `base` property
- `src/App.tsx` - Router `basename` property

### Environment Variables

Create a `.env` file for environment-specific variables:
```
VITE_API_BASE_URL=your_api_url
VITE_API_KEY=your_api_key
```

## Data Sources

Currently using sample data. Update the following files with actual API integration:
- `src/components/maps/MapVisualization.tsx` - Map data points
- `src/components/charts/*.tsx` - Chart data
- `src/services/` - API service functions

## NASA Security Considerations

This application is designed with NASA security requirements in mind:
- All external API calls should be proxied through the server in production
- Sensitive API keys should be stored as environment variables
- CORS configuration should be handled server-side

## License

NASA Internal Use Only
