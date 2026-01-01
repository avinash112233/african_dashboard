import { useState } from 'react';
import { Container, Row, Col, Card, Tabs, Tab } from 'react-bootstrap';
import MapVisualization from '../components/maps/MapVisualization';
import TimeSeriesChart from '../components/charts/TimeSeriesChart';
import ScatterPlotChart from '../components/charts/ScatterPlotChart';
import BarChart from '../components/charts/BarChart';
import './DashboardPage.css';

const DashboardPage = () => {
  const [selectedData, setSelectedData] = useState<any>(null);

  return (
    <div className="dashboard-page">
      <Container fluid className="py-3">
        <Row>
          <Col lg={8}>
            <Card className="mb-3">
              <Card.Header>
                <h4>Interactive Map</h4>
              </Card.Header>
              <Card.Body style={{ height: '600px', padding: 0 }}>
                <MapVisualization onDataSelect={setSelectedData} />
              </Card.Body>
            </Card>
          </Col>

          <Col lg={4}>
            <Card className="mb-3">
              <Card.Header>
                <h4>Data Analysis</h4>
              </Card.Header>
              <Card.Body>
                <Tabs defaultActiveKey="timeseries" className="mb-3">
                  <Tab eventKey="timeseries" title="Timeseries">
                    <div style={{ height: '250px' }}>
                      <TimeSeriesChart data={selectedData} />
                    </div>
                  </Tab>
                  <Tab eventKey="scatter" title="Scatter Plot">
                    <div style={{ height: '250px' }}>
                      <ScatterPlotChart data={selectedData} />
                    </div>
                  </Tab>
                  <Tab eventKey="bar" title="Bar Chart">
                    <div style={{ height: '250px' }}>
                      <BarChart data={selectedData} />
                    </div>
                  </Tab>
                </Tabs>
              </Card.Body>
            </Card>

            <Card>
              <Card.Header>
                <h5>Selected Data Info</h5>
              </Card.Header>
              <Card.Body>
                {selectedData ? (
                  <div>
                    <p><strong>Location:</strong> {selectedData.location || 'N/A'}</p>
                    <p><strong>Parameter:</strong> {selectedData.parameter || 'N/A'}</p>
                    <p><strong>Value:</strong> {selectedData.value || 'N/A'}</p>
                    <p><strong>Date:</strong> {selectedData.date || 'N/A'}</p>
                  </div>
                ) : (
                  <p className="text-muted">Select a point on the map to view data</p>
                )}
              </Card.Body>
            </Card>
          </Col>
        </Row>
      </Container>
    </div>
  );
};

export default DashboardPage;



