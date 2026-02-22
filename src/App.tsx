import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import 'bootstrap/dist/css/bootstrap.min.css';
import './App.css';

// Layout
import Navigation from './components/layout/Navigation';
import ErrorBoundary from './components/ErrorBoundary';

// Pages
import HomePage from './pages/HomePage';
import DashboardPage from './pages/DashboardPage';
import DataDownloadPage from './pages/DataDownloadPage';
import PublicationsPage from './pages/PublicationsPage';
import TeamPage from './pages/TeamPage';

function App() {
  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Router basename="/">
        <div className="App">
          <Navigation />
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/dashboard" element={<ErrorBoundary><DashboardPage /></ErrorBoundary>} />
            <Route path="/data-download" element={<DataDownloadPage />} />
            <Route path="/publications" element={<PublicationsPage />} />
            <Route path="/team" element={<TeamPage />} />
          </Routes>
        </div>
      </Router>
    </LocalizationProvider>
  );
}

export default App;
