import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import './HomePage.css';

// ── Animated counter hook ────────────────────────────────────────────────────
function useCounter(target: number, duration = 1800, start = false) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!start) return;
    let startTime: number | null = null;
    const step = (ts: number) => {
      if (!startTime) startTime = ts;
      const progress = Math.min((ts - startTime) / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(eased * target));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [start, target, duration]);
  return value;
}

// ── Stat card with intersection-triggered counter ────────────────────────────
interface StatCardProps {
  value?: number;
  suffix?: string;
  text?: string;
  label: string;
  delay?: number;
}
function StatCard({ value, suffix = '', text, label, delay = 0 }: StatCardProps) {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setTimeout(() => setVisible(true), delay); obs.disconnect(); } },
      { threshold: 0.3 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [delay]);
  const count = useCounter(value ?? 0, 1600, visible && value != null);
  return (
    <div className={`hp-stat-card${text ? ' hp-stat-card--text' : ''}`} ref={ref}>
      <div className="hp-stat-number">
        {text ?? `${count}${suffix}`}
      </div>
      <div className="hp-stat-label">{label}</div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
const HomePage = () => {
  return (
    <div className="hp-root">

      {/* ── HERO ── */}
      <section className="hp-hero">
        <div className="hp-hero-overlay" />
        <div className="hp-hero-content">
          <div className="hp-hero-badge">NASA · AERONET · FIRMS · MERRA-2</div>
          <h1 className="hp-hero-title">African Aerosol<br />Quality Dashboard</h1>
          <p className="hp-hero-sub">
            Real-time air quality monitoring and PM2.5 forecasting across the African continent.
            Powered by satellite observations, ground-based measurements, and machine-learning models.
          </p>
          <div className="hp-hero-actions">
            <Link to="/dashboard" className="hp-btn hp-btn-primary">
              Open Dashboard →
            </Link>
            <a href="#about" className="hp-btn hp-btn-ghost">
              Learn More
            </a>
          </div>
        </div>
        <div className="hp-hero-scroll-hint">↓</div>
      </section>

      {/* ── STATS BAR ── */}
      <section className="hp-stats">
        <StatCard value={500} suffix="+" label="AERONET Monitoring Sites" delay={0} />
        <StatCard text="Pan-African" label="Continental Coverage" delay={100} />
        <StatCard value={5}               label="Integrated Data Layers"        delay={200} />
        <StatCard value={3}               label="Day PM2.5 Forecast Horizon"   delay={300} />
      </section>

      {/* ── FEATURES ── */}
      <section className="hp-section hp-features-section">
        <div className="hp-section-inner">
          <p className="hp-section-eyebrow">What's Inside</p>
          <h2 className="hp-section-title">Five Integrated Data Layers</h2>
          <p className="hp-section-sub">
            Switch between layers on the interactive map — each one powered by a different
            NASA or ensemble data source.
          </p>

          <div className="hp-features-grid">
            {[
              {
                icon: '🛰️',
                title: 'AERONET AOD',
                color: '#2563eb',
                desc: 'Ground-truth aerosol optical depth from NASA\'s global sun-photometer network. Hundreds of African stations with daily measurements dating back to the early 2000s.',
              },
              {
                icon: '🔥',
                title: 'Fire Hotspots',
                color: '#dc2626',
                desc: 'Active fire detections from NASA FIRMS (VIIRS NOAA-21, 375 m resolution). Updated multiple times daily — track wildfire and agricultural burn activity across the continent.',
              },
              {
                icon: '🖼️',
                title: 'VIIRS Imagery',
                color: '#7c3aed',
                desc: 'True-color and false-color satellite imagery tiles from NASA\'s Visible Infrared Imaging Radiometer Suite, giving spatial context to aerosol and fire events.',
              },
              {
                icon: '📡',
                title: 'MERRA-2 CNN PM2.5',
                color: '#16a34a',
                desc: 'Surface PM2.5 concentrations predicted by a convolutional neural network trained on MERRA-2 reanalysis data. Full AQI classification for every station point.',
              },
              {
                icon: '🌬️',
                title: 'AAQE PM2.5 Forecast',
                color: '#9333ea',
                desc: 'African Air Quality Ensemble 3-hourly PM2.5 forecast up to 3 days ahead. Click any forecast point to see the full hourly AQI timeline and outlook cards.',
              },
            ].map((f) => (
              <div key={f.title} className="hp-feature-card" style={{ '--accent': f.color } as React.CSSProperties}>
                <div className="hp-feature-icon">{f.icon}</div>
                <h3 className="hp-feature-title">{f.title}</h3>
                <p className="hp-feature-desc">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── ANALYSIS ── */}
      <section className="hp-section hp-analysis-section">
        <div className="hp-section-inner hp-analysis-inner">
          <div className="hp-analysis-text">
            <p className="hp-section-eyebrow">Cross-Layer Analysis</p>
            <h2 className="hp-section-title">Compare. Correlate. Export.</h2>
            <p className="hp-section-sub" style={{ textAlign: 'left' }}>
              Select any location on the map and open the Analysis panel to pull time-series data
              from all five layers simultaneously. Plot individual variables, run scatter correlations,
              and view a combined comparison chart — then download everything as a crisp PDF report.
            </p>
            <ul className="hp-analysis-list">
              <li>📈 Individual time-series for each data source</li>
              <li>🔗 Scatter correlation between any two variables</li>
              <li>📊 Combined overlay comparison chart</li>
              <li>📄 One-click PDF export with annotated data point values</li>
              <li>📥 Raw CSV download for offline analysis</li>
            </ul>
            <Link to="/dashboard" className="hp-btn hp-btn-primary" style={{ marginTop: 24, display: 'inline-block' }}>
              Try it on the Dashboard →
            </Link>
          </div>
          <div className="hp-analysis-visual">
            <div className="hp-analysis-card">
              <div className="hp-analysis-card-header">
                <span className="hp-analysis-dot" style={{ background: '#2563eb' }} /> AERONET AOD 500nm
              </div>
              <div className="hp-analysis-chart-mock">
                <svg viewBox="0 0 300 100" preserveAspectRatio="none" className="hp-mock-svg">
                  <polyline
                    points="0,70 40,55 80,60 120,35 160,40 200,25 240,30 300,20"
                    fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinejoin="round"
                  />
                  <polyline
                    points="0,70 40,55 80,60 120,35 160,40 200,25 240,30 300,20"
                    fill="url(#grad)" stroke="none"
                  />
                  <defs>
                    <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2563eb" stopOpacity="0.2" />
                      <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                </svg>
              </div>
              <div className="hp-analysis-card-header" style={{ marginTop: 12 }}>
                <span className="hp-analysis-dot" style={{ background: '#16a34a' }} /> MERRA-2 PM2.5
              </div>
              <div className="hp-analysis-chart-mock">
                <svg viewBox="0 0 300 100" preserveAspectRatio="none" className="hp-mock-svg">
                  <polyline
                    points="0,80 40,65 80,50 120,55 160,30 200,35 240,20 300,25"
                    fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinejoin="round"
                  />
                </svg>
              </div>
              <div className="hp-analysis-card-footer">
                ⬇ Download PDF &nbsp;·&nbsp; ⬇ Download CSV
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── ABOUT ── */}
      <section className="hp-section hp-about-section" id="about">
        <div className="hp-section-inner hp-about-inner">
          <div className="hp-about-text">
            <p className="hp-section-eyebrow">About the Project</p>
            <h2 className="hp-section-title">Built for African Air Quality Research</h2>
            <p className="hp-about-para">
              The African Aerosol Quality Dashboard is a research platform developed at the
              University of Maryland Baltimore County (UMBC) to support air quality monitoring,
              forecasting, and scientific analysis across the African continent.
            </p>
            <p className="hp-about-para">
              Africa faces significant air quality challenges driven by desert dust transport,
              biomass burning, and growing urban emissions. This platform integrates multiple
              satellite and model-based data streams to give researchers and policymakers a
              single, unified view of aerosol conditions at continental scale.
            </p>
            <p className="hp-about-para">
              Data is sourced from NASA AERONET, NASA FIRMS, MERRA-2 reanalysis, and the
              African Air Quality Ensemble (AAQE) forecast system. The analysis tools support
              cross-dataset comparison and PDF reporting for scientific use.
            </p>
          </div>
          <div className="hp-about-highlights">
            {[
              { icon: '🌍', title: 'Continental Scale', desc: 'Pan-African coverage from the Sahara to southern Africa' },
              { icon: '⚡', title: 'Real-Time Data', desc: 'Fire detections and forecasts updated multiple times daily' },
              { icon: '🤖', title: 'ML-Powered', desc: 'CNN model trained on MERRA-2 reanalysis for PM2.5 estimation' },
              { icon: '📖', title: 'Open Research', desc: 'Built for researchers, policymakers, and the scientific community' },
            ].map((h) => (
              <div key={h.title} className="hp-highlight-item">
                <span className="hp-highlight-icon">{h.icon}</span>
                <div>
                  <div className="hp-highlight-title">{h.title}</div>
                  <div className="hp-highlight-desc">{h.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA FOOTER ── */}
      <section className="hp-cta">
        <h2 className="hp-cta-title">Ready to explore African air quality?</h2>
        <p className="hp-cta-sub">Open the interactive dashboard and start analyzing data across all five layers.</p>
        <Link to="/dashboard" className="hp-btn hp-btn-primary hp-btn-lg">
          Open Dashboard →
        </Link>
      </section>

    </div>
  );
};

export default HomePage;
