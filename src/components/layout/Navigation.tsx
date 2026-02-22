import { Navbar, Nav, Container } from 'react-bootstrap';
import { Link, useLocation } from 'react-router-dom';
import './Navigation.css';

const Navigation = () => {
  const location = useLocation();

  const isActive = (path: string) => {
    return location.pathname === path ? 'active' : '';
  };

  return (
    <Navbar expand="lg" className="navbar-custom">
      <Container fluid>
        <Navbar.Brand as={Link} to="/">
          African Aerosol Dashboard
        </Navbar.Brand>
        <Navbar.Toggle aria-controls="basic-navbar-nav" />
        <Navbar.Collapse id="basic-navbar-nav">
          <Nav className="ms-auto">
            <Nav.Link as={Link} to="/" className={isActive('/')}>
              Home
            </Nav.Link>
            <Nav.Link as={Link} to="/dashboard" className={isActive('/dashboard')}>
              Dashboard
            </Nav.Link>
            <Nav.Link as={Link} to="/data-download" className={isActive('/data-download')}>
              Data Download
            </Nav.Link>
            <Nav.Link as={Link} to="/publications" className={isActive('/publications')}>
              Publications
            </Nav.Link>
            <Nav.Link as={Link} to="/team" className={isActive('/team')}>
              Team
            </Nav.Link>
          </Nav>
        </Navbar.Collapse>
      </Container>
    </Navbar>
  );
};

export default Navigation;



