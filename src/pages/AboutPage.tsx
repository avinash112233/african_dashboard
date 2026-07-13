import {
  AAQE_DASHBOARD_DESIGN,
  AAQE_FORECAST_AND_ACCESS,
  AAQE_HISTORICAL_DATASETS,
  AAQE_NRT_LAYERS,
  AAQE_PRIMARY_GOALS,
  AAQE_PROJECT_MOTIVATION,
  AAQE_PROJECT_TAGLINE,
  AAQE_SCIENCE_FOCUS,
  AAQE_STAKEHOLDER_ROLE,
} from '../content/aaqeAbout';
import '../styles/aaqeContentPages.css';

function AboutBulletCard({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="aaqe-about-card">
      <h3>{title}</h3>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

const AboutPage = () => {
  return (
    <main className="aaqe-content-page">
      <section className="aaqe-content-hero">
        <h1>HAQAST Project: African Air Quality Explorer</h1>
        <p>
          <strong>African Air Quality Explorer Powered by NASA Data and Research</strong>{' '}
          {AAQE_PROJECT_TAGLINE.replace(
            /^African Air Quality Explorer Powered by NASA Data and Research\s*/i,
            ''
          )}
        </p>
      </section>

      <section className="aaqe-content-section">
        <div className="aaqe-content-heading-row">
          <h2>Project motivation</h2>
          <span>HAQAST Earth Action</span>
        </div>
        <p className="aaqe-about-highlight">{AAQE_PROJECT_MOTIVATION}</p>
        <div className="aaqe-about-grid">
          <AboutBulletCard title="Primary project goals" items={AAQE_PRIMARY_GOALS} />
          <AboutBulletCard title="Stakeholder and capacity-building role" items={AAQE_STAKEHOLDER_ROLE} />
          <AboutBulletCard title="Science focus" items={AAQE_SCIENCE_FOCUS} />
        </div>
      </section>

      <section className="aaqe-content-section">
        <div className="aaqe-content-heading-row">
          <h2>AAQE data and dashboard capabilities</h2>
          <span>Historical · NRT · Forecast</span>
        </div>
        <div className="aaqe-about-grid">
          <AboutBulletCard title="Historical datasets" items={AAQE_HISTORICAL_DATASETS} />
          <AboutBulletCard title="Near-real-time satellite layers" items={AAQE_NRT_LAYERS} />
          <AboutBulletCard title="Forecast and user access" items={AAQE_FORECAST_AND_ACCESS} />
        </div>
      </section>

      <section className="aaqe-content-section">
        <div className="aaqe-content-heading-row">
          <h2>Dashboard design concept</h2>
          <span>Overview to local detail</span>
        </div>
        <p>{AAQE_DASHBOARD_DESIGN}</p>
      </section>
    </main>
  );
};

export default AboutPage;
