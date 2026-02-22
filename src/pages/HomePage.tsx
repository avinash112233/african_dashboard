import { Container, Row, Col, Card, Button } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import './HomePage.css';

const HomePage = () => {
  return (
    <div className="home-page">
      <Container className="py-5">
        <Row>
          <Col>
            <div className="hero-section text-center mb-5">
              <h1 className="display-4 mb-3">African Aerosol Dashboard</h1>
              <p className="lead mb-4">
                Comprehensive aerosol monitoring and data visualization platform for Africa
              </p>
              <Link to="/dashboard" className="text-decoration-none">
                <Button variant="primary" size="lg">Explore Dashboard</Button>
              </Link>
            </div>
          </Col>
        </Row>

        <Row className="mt-5">
          <Col md={4} className="mb-4">
            <Card className="h-100 feature-card">
              <Card.Body>
                <Card.Title>
                  <h3>Data Visualization</h3>
                </Card.Title>
                <Card.Text>
                  Interactive maps with point locations, heat maps, and satellite imagery. 
                  Analyze timeseries data with scatter plots and bar charts.
                </Card.Text>
                <Link to="/dashboard" className="text-decoration-none">
                  <Button variant="outline-primary">View Visualizations</Button>
                </Link>
              </Card.Body>
            </Card>
          </Col>

          <Col md={4} className="mb-4">
            <Card className="h-100 feature-card">
              <Card.Body>
                <Card.Title>
                  <h3>Data Download</h3>
                </Card.Title>
                <Card.Text>
                  Select datasets and parameters to download in CSV or NetCDF format. 
                  Access historical and real-time aerosol data.
                </Card.Text>
                <Link to="/data-download" className="text-decoration-none">
                  <Button variant="outline-primary">Download Data</Button>
                </Link>
              </Card.Body>
            </Card>
          </Col>

          <Col md={4} className="mb-4">
            <Card className="h-100 feature-card">
              <Card.Body>
                <Card.Title>
                  <h3>Research & Publications</h3>
                </Card.Title>
                <Card.Text>
                  Browse our research publications and learn about the latest findings 
                  in aerosol monitoring and climate research.
                </Card.Text>
                <Link to="/publications" className="text-decoration-none">
                  <Button variant="outline-primary">View Publications</Button>
                </Link>
              </Card.Body>
            </Card>
          </Col>
        </Row>

        <Row className="mt-5">
          <Col>
            <Card>
              <Card.Body>
                <Card.Title>About This Project</Card.Title>
                <Card.Text>
                  The African Aerosol Dashboard provides comprehensive tools for monitoring 
                  and analyzing aerosol data across Africa. This platform enables researchers, 
                  policymakers, and the public to explore aerosol measurements, visualize 
                  spatial and temporal patterns, and access data for scientific research.
                </Card.Text>
                <Card.Text>
                  The dashboard supports multiple visualization modes including point location 
                  mapping, heat maps for density analysis, and satellite image overlays. 
                  Advanced analytics include timeseries analysis, scatter plots, and bar charts 
                  for detailed data exploration.
                </Card.Text>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      </Container>
    </div>
  );
};

export default HomePage;



