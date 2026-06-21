import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import 'bootstrap/dist/css/bootstrap.min.css';
import './App.css';

import Navigation from './components/layout/Navigation';
import ErrorBoundary from './components/ErrorBoundary';
import HomePage from './pages/HomePage';

const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const PublicationsPage = lazy(() => import('./pages/PublicationsPage'));
const TeamPage = lazy(() => import('./pages/TeamPage'));

const PageFallback = () => (
  <div style={{ padding: 48, textAlign: 'center', color: '#64748b' }}>Loading…</div>
);

function App() {
  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Router basename="/">
        <div className="App">
          <Navigation />
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/home" element={<HomePage />} />
            <Route
              path="/dashboard"
              element={
                <ErrorBoundary>
                  <Suspense fallback={<PageFallback />}>
                    <DashboardPage />
                  </Suspense>
                </ErrorBoundary>
              }
            />
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
