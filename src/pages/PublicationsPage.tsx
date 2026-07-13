import { AAQE_PUBLICATIONS } from '../content/aaqePublications';
import '../styles/aaqeContentPages.css';

const PublicationsPage = () => {
  return (
    <main className="aaqe-content-page">
      <section className="aaqe-content-hero">
        <h1>Related Publications</h1>
        <p>
          Selected publications and data products supporting the AAQE scientific basis, including
          machine-learning PM2.5 forecasting, MERRA2-CNN PM2.5, geostationary PM2.5, AOD retrievals,
          AERONET-based aerosol information, and fire/smoke air-quality applications.
        </p>
      </section>

      <section className="aaqe-content-section">
        <div className="aaqe-content-heading-row">
          <h2>Publications and Data Products</h2>
          <span>{AAQE_PUBLICATIONS.length} references</span>
        </div>
        <ol className="aaqe-publication-list">
          {AAQE_PUBLICATIONS.map((pub) => (
            <li key={pub.id}>
              {pub.authors}, &ldquo;{pub.title},&rdquo; <em>{pub.journal}</em>, {pub.year}, doi:{' '}
              <a href={`https://doi.org/${pub.doi}`} target="_blank" rel="noopener noreferrer">
                {pub.doi}
              </a>
              .
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
};

export default PublicationsPage;
