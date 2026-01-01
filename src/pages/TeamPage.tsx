import { Container, Row, Col, Card } from 'react-bootstrap';
import './TeamPage.css';

// This will be populated with actual team member data
const teamMembers = [
  {
    id: 1,
    name: 'Dr. John Smith',
    role: 'Principal Investigator',
    email: 'john.smith@example.com',
    bio: 'Expert in atmospheric sciences and aerosol research with over 20 years of experience.',
    image: null
  },
  {
    id: 2,
    name: 'Dr. Jane Doe',
    role: 'Research Scientist',
    email: 'jane.doe@example.com',
    bio: 'Specializes in remote sensing and data analysis for climate research.',
    image: null
  },
  // Add more team members as needed
];

const TeamPage = () => {
  return (
    <div className="team-page">
      <Container className="py-4">
        <Row>
          <Col>
            <h2 className="mb-4">Project Team</h2>
            <p className="lead mb-4">
              Meet the researchers and scientists working on the African Aerosol Dashboard project
            </p>
          </Col>
        </Row>

        <Row>
          {teamMembers.length > 0 ? (
            teamMembers.map((member) => (
              <Col md={6} lg={4} key={member.id} className="mb-4">
                <Card className="h-100 team-member-card">
                  <Card.Body className="text-center">
                    {member.image ? (
                      <img
                        src={member.image}
                        alt={member.name}
                        className="team-member-image mb-3"
                      />
                    ) : (
                      <div className="team-member-placeholder mb-3">
                        {member.name.charAt(0)}
                      </div>
                    )}
                    <Card.Title>{member.name}</Card.Title>
                    <Card.Subtitle className="mb-2 text-muted">
                      {member.role}
                    </Card.Subtitle>
                    <Card.Text>{member.bio}</Card.Text>
                    <Card.Text>
                      <a href={`mailto:${member.email}`}>{member.email}</a>
                    </Card.Text>
                  </Card.Body>
                </Card>
              </Col>
            ))
          ) : (
            <Col>
              <Card>
                <Card.Body>
                  <Card.Text className="text-muted">
                    Team member information will be displayed here. Please add team member data to populate this page.
                  </Card.Text>
                </Card.Body>
              </Card>
            </Col>
          )}
        </Row>
      </Container>
    </div>
  );
};

export default TeamPage;



