import { AAQE_TEAM_SECTIONS } from '../content/aaqeTeam';
import { getTeamInitials } from '../utils/teamUtils';
import '../styles/aaqeContentPages.css';

const TeamPage = () => {
  return (
    <main className="aaqe-content-page">
      <section className="aaqe-content-hero">
        <h1>Project Team</h1>
        <p>
          Team members and collaborators supporting the African Air Quality Explorer dashboard,
          NASA data integration, air-quality analysis, forecasting, stakeholder engagement,
          training, and dissemination.
        </p>
      </section>

      {AAQE_TEAM_SECTIONS.map((section) => (
        <section key={section.heading} className="aaqe-content-section">
          <div className="aaqe-content-heading-row">
            <h2>{section.heading}</h2>
            <span>
              {section.members.length} member{section.members.length === 1 ? '' : 's'}
            </span>
          </div>
          <div
            className={`aaqe-team-grid${
              section.heading === 'Collaborators' ? ' collab-grid' : ''
            }`}
          >
            {section.members.map((member) => (
              <article key={member.name} className="aaqe-team-card">
                <div className="aaqe-team-avatar">{getTeamInitials(member.name)}</div>
                <div>
                  <h3>{member.name}</h3>
                  {member.title && member.title !== 'Collaborator' && (
                    <div className="aaqe-team-role">{member.title}</div>
                  )}
                  <div className="aaqe-team-affiliation">
                    <i className="bi bi-building" aria-hidden="true" /> {member.affiliation}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
};

export default TeamPage;
