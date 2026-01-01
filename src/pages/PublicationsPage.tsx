import { Container, Row, Col, Card } from 'react-bootstrap';
import './PublicationsPage.css';

// This will be populated with actual publication data
const publications = [
  {
    id: 1,
    title: 'Aerosol Monitoring in Africa: A Comprehensive Analysis',
    authors: 'Smith, J., Johnson, A., Williams, B.',
    year: 2024,
    journal: 'Atmospheric Environment',
    doi: '10.1016/j.atmosenv.2024.123456',
    abstract: 'This study presents a comprehensive analysis of aerosol monitoring across Africa...'
  },
  {
    id: 2,
    title: 'Spatial and Temporal Patterns of AOD in Sub-Saharan Africa',
    authors: 'Brown, C., Davis, D., Miller, E.',
    year: 2023,
    journal: 'Remote Sensing of Environment',
    doi: '10.1016/j.rse.2023.789012',
    abstract: 'We analyze spatial and temporal patterns of Aerosol Optical Depth...'
  },
  // Add more publications as needed
];

const PublicationsPage = () => {
  return (
    <div className="publications-page">
      <Container className="py-4">
        <Row>
          <Col>
            <h2 className="mb-4">Research Publications</h2>
            <p className="lead mb-4">
              Publications related to aerosol monitoring and research in Africa
            </p>
          </Col>
        </Row>

        <Row>
          <Col>
            {publications.length > 0 ? (
              publications.map((pub) => (
                <Card key={pub.id} className="mb-3">
                  <Card.Body>
                    <Card.Title>{pub.title}</Card.Title>
                    <Card.Subtitle className="mb-2 text-muted">
                      {pub.authors} ({pub.year})
                    </Card.Subtitle>
                    <Card.Text className="mb-2">
                      <strong>Journal:</strong> {pub.journal}
                    </Card.Text>
                    <Card.Text className="mb-2">
                      <strong>DOI:</strong>{' '}
                      <a href={`https://doi.org/${pub.doi}`} target="_blank" rel="noopener noreferrer">
                        {pub.doi}
                      </a>
                    </Card.Text>
                    <Card.Text>
                      <strong>Abstract:</strong> {pub.abstract}
                    </Card.Text>
                  </Card.Body>
                </Card>
              ))
            ) : (
              <Card>
                <Card.Body>
                  <Card.Text className="text-muted">
                    Publications will be listed here. Please add publication data to populate this page.
                  </Card.Text>
                </Card.Body>
              </Card>
            )}
          </Col>
        </Row>
      </Container>
    </div>
  );
};

export default PublicationsPage;



