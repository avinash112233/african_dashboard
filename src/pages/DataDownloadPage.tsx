import { useState } from 'react';
import { Container, Row, Col, Card, Alert } from 'react-bootstrap';
import DataDownloadForm from '../components/dataDownload/DataDownloadForm';
import './DataDownloadPage.css';

const DataDownloadPage = () => {
  const [downloadStatus, setDownloadStatus] = useState<string>('');

  return (
    <div className="data-download-page">
      <Container className="py-4">
        <Row>
          <Col>
            <h2 className="mb-4">Data Download</h2>
            <p className="lead mb-4">
              Select datasets and parameters to download in CSV or NetCDF format
            </p>
          </Col>
        </Row>

        <Row>
          <Col lg={8}>
            <Card>
              <Card.Header>
                <h4>Download Configuration</h4>
              </Card.Header>
              <Card.Body>
                <DataDownloadForm onDownloadStatus={setDownloadStatus} />
              </Card.Body>
            </Card>
          </Col>

          <Col lg={4}>
            <Card>
              <Card.Header>
                <h5>Download Information</h5>
              </Card.Header>
              <Card.Body>
                <h6>Available Formats:</h6>
                <ul>
                  <li><strong>CSV:</strong> Comma-separated values format for easy data analysis</li>
                  <li><strong>NetCDF:</strong> Network Common Data Form for scientific data storage</li>
                </ul>
                
                <h6 className="mt-3">Available Parameters:</h6>
                <ul>
                  <li>AOD (Aerosol Optical Depth)</li>
                  <li>PM2.5</li>
                  <li>PM10</li>
                  <li>Angstrom Exponent</li>
                  <li>Fine Mode Fraction</li>
                </ul>

                {downloadStatus && (
                  <Alert variant={downloadStatus.includes('success') ? 'success' : 'info'} className="mt-3">
                    {downloadStatus}
                  </Alert>
                )}
              </Card.Body>
            </Card>
          </Col>
        </Row>
      </Container>
    </div>
  );
};

export default DataDownloadPage;



