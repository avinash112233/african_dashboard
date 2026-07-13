import { useMemo, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { isDashboardV2Enabled } from '../../utils/featureFlags';

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: 'bi-speedometer2' },
  { to: '/dashboard-2', label: 'Dashboard 2', icon: 'bi-layout-wtf' },
  { to: '/about', label: 'About', icon: 'bi-info-circle' },
  { to: '/team', label: 'Team', icon: 'bi-people' },
  { to: '/publications', label: 'Publications', icon: 'bi-journal-text' },
] as const;

const Navigation = () => {
  const [menuOpen, setMenuOpen] = useState(false);
  const navItems = useMemo(
    () => NAV_ITEMS.filter((item) => isDashboardV2Enabled() || item.to !== '/dashboard-2'),
    []
  );

  return (
    <header className="aaqe-hero-header">
      <div className="aaqe-header-inner">
        <Link to="/dashboard" className="aaqe-brand-lockup" onClick={() => setMenuOpen(false)}>
          <div className="aaqe-brand-icon" aria-hidden="true">
            AQ
          </div>
          <div>
            <h1 className="aaqe-brand-title">African Air Quality Explorer</h1>
            <div className="aaqe-brand-subtitle">
              NASA HAQAST project · Air quality monitoring, analysis, and forecasting for Africa
            </div>
          </div>
        </Link>

        <button
          type="button"
          className="aaqe-nav-toggle"
          aria-expanded={menuOpen}
          aria-label="Toggle navigation"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <i className={`bi ${menuOpen ? 'bi-x-lg' : 'bi-list'}`} aria-hidden="true" />
        </button>

        <nav
          className={`aaqe-top-page-nav${menuOpen ? ' open' : ''}`}
          aria-label="AAQE pages"
        >
          {navItems.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => `aaqe-top-page-btn${isActive ? ' active' : ''}`}
              onClick={() => setMenuOpen(false)}
            >
              <i className={`bi ${icon}`} aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>
      </div>
    </header>
  );
};

export default Navigation;
