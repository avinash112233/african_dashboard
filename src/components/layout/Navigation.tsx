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
      <Container fluid className="navbar-inner">
        <Navbar.Brand as={Link} to="/dashboard" className="navbar-brand-wrap">
          <span className="navbar-brand-text">African Aerosol Dashboard</span>
        </Navbar.Brand>
        <Navbar.Toggle aria-controls="basic-navbar-nav" className="navbar-toggle-btn" />
        <Navbar.Collapse id="basic-navbar-nav" className="navbar-collapse-wrap">
          <Nav className="navbar-nav-links">
            <Nav.Link as={Link} to="/home" className={isActive('/home')}>
              Home
            </Nav.Link>
            <Nav.Link
              as={Link}
              to="/dashboard"
              className={`nav-link-dashboard ${isActive('/dashboard')}`}
            >
              Dashboard
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



