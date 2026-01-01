import { useState } from 'react';
import { Form, Button, Row, Col, Card } from 'react-bootstrap';
import Papa from 'papaparse';

interface DataDownloadFormProps {
  onDownloadStatus?: (status: string) => void;
}

const DataDownloadForm = ({ onDownloadStatus }: DataDownloadFormProps) => {
  const [selectedDatasets, setSelectedDatasets] = useState<string[]>([]);
  const [selectedParameters, setSelectedParameters] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [format, setFormat] = useState<'csv' | 'netcdf'>('csv');

  const datasets = ['AERONET', 'MODIS', 'VIIRS', 'Ground Stations'];
  const parameters = ['AOD', 'PM2.5', 'PM10', 'Angstrom Exponent', 'Fine Mode Fraction'];

  const handleDatasetChange = (dataset: string) => {
    setSelectedDatasets((prev) =>
      prev.includes(dataset) ? prev.filter((d) => d !== dataset) : [...prev, dataset]
    );
  };

  const handleParameterChange = (parameter: string) => {
    setSelectedParameters((prev) =>
      prev.includes(parameter) ? prev.filter((p) => p !== parameter) : [...prev, parameter]
    );
  };

  const handleDownload = () => {
    if (selectedDatasets.length === 0 || selectedParameters.length === 0) {
      if (onDownloadStatus) {
        onDownloadStatus('Please select at least one dataset and one parameter');
      }
      return;
    }

    if (format === 'csv') {
      handleCSVDownload();
    } else {
      handleNetCDFDownload();
    }
  };

  const handleCSVDownload = () => {
    // Generate sample CSV data
    const headers = ['Date', 'Location', 'Parameter', 'Value', 'Unit'];
    const sampleData = [
      ['2024-01-01', 'Nairobi', 'AOD', '0.45', ''],
      ['2024-01-01', 'Lagos', 'AOD', '0.52', ''],
      ['2024-01-02', 'Nairobi', 'AOD', '0.47', ''],
      ['2024-01-02', 'Lagos', 'AOD', '0.55', ''],
    ];

    const csv = Papa.unparse({
      fields: headers,
      data: sampleData,
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aerosol_data_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    if (onDownloadStatus) {
      onDownloadStatus('✅ CSV file downloaded successfully!');
    }
  };

  const handleNetCDFDownload = () => {
    // NetCDF download requires backend processing
    // For now, show a message that this feature requires server-side generation
    if (onDownloadStatus) {
      onDownloadStatus('⚠️ NetCDF format requires server-side processing. Please contact the administrator or use CSV format for now.');
    }
  };

  return (
    <Form>
      <Form.Group className="mb-3">
        <Form.Label>Select Datasets</Form.Label>
        <Row>
          {datasets.map((dataset) => (
            <Col md={6} key={dataset}>
              <Form.Check
                type="checkbox"
                label={dataset}
                checked={selectedDatasets.includes(dataset)}
                onChange={() => handleDatasetChange(dataset)}
              />
            </Col>
          ))}
        </Row>
      </Form.Group>

      <Form.Group className="mb-3">
        <Form.Label>Select Parameters</Form.Label>
        <Row>
          {parameters.map((parameter) => (
            <Col md={6} key={parameter}>
              <Form.Check
                type="checkbox"
                label={parameter}
                checked={selectedParameters.includes(parameter)}
                onChange={() => handleParameterChange(parameter)}
              />
            </Col>
          ))}
        </Row>
      </Form.Group>

      <Row className="mb-3">
        <Col md={6}>
          <Form.Group>
            <Form.Label>Start Date</Form.Label>
            <Form.Control
              type="date"
              value={dateRange.start}
              onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
            />
          </Form.Group>
        </Col>
        <Col md={6}>
          <Form.Group>
            <Form.Label>End Date</Form.Label>
            <Form.Control
              type="date"
              value={dateRange.end}
              onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
            />
          </Form.Group>
        </Col>
      </Row>

      <Form.Group className="mb-3">
        <Form.Label>Download Format</Form.Label>
        <Form.Select value={format} onChange={(e) => setFormat(e.target.value as 'csv' | 'netcdf')}>
          <option value="csv">CSV (Comma-Separated Values)</option>
          <option value="netcdf">NetCDF (Network Common Data Form)</option>
        </Form.Select>
      </Form.Group>

      <Button variant="primary" onClick={handleDownload} className="w-100">
        Download Data
      </Button>
    </Form>
  );
};

export default DataDownloadForm;



