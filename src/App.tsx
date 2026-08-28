import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import 'bootstrap/dist/css/bootstrap.min.css';
import './styles/aaqeTheme.css';
import './App.css';

import Navigation from './components/layout/Navigation';
import ErrorBoundary from './components/ErrorBoundary';
import AboutPage from './pages/AboutPage';
import { isDashboardV2Enabled, isDashboardV2Only } from './utils/featureFlags';
import { ensureFiresPrefetched } from './services/firmsApi';

const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const DashboardPageV2 = lazy(() => import('./pages/DashboardPageV2'));
const PublicationsPage = lazy(() => import('./pages/PublicationsPage'));
const TeamPage = lazy(() => import('./pages/TeamPage'));

const PageFallback = () => (
  <div style={{ padding: 48, textAlign: 'center', color: '#64748b' }}>Loading…</div>
);

function App() {
  const dashboardV2Enabled = isDashboardV2Enabled();
  const dashboardV2Only = isDashboardV2Only();

  useEffect(() => {
    void ensureFiresPrefetched();
  }, []);

  const dashboardElement = (
    <ErrorBoundary>
      <Suspense fallback={<PageFallback />}>
        {dashboardV2Only ? <DashboardPageV2 /> : <DashboardPage />}
      </Suspense>
    </ErrorBoundary>
  );

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Router basename="/">
        <div className="App">
          <Navigation />
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="/home" element={<Navigate to="/about" replace />} />
            <Route path="/dashboard" element={dashboardElement} />
            {dashboardV2Enabled && !dashboardV2Only ? (
              <Route
                path="/dashboard-2"
                element={
                  <ErrorBoundary>
                    <Suspense fallback={<PageFallback />}>
                      <DashboardPageV2 />
                    </Suspense>
                  </ErrorBoundary>
                }
              />
            ) : (
              <Route path="/dashboard-2" element={<Navigate to="/dashboard" replace />} />
            )}
            <Route
              path="/publications"
              element={
                <Suspense fallback={<PageFallback />}>
                  <PublicationsPage />
                </Suspense>
              }
            />
            <Route
              path="/team"
              element={
                <Suspense fallback={<PageFallback />}>
                  <TeamPage />
                </Suspense>
              }
            />
          </Routes>
        </div>
      </Router>
    </LocalizationProvider>
  );
}

export default App;
