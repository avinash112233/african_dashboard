/**
 * AAQE project team — sourced from project Team materials.
 */

export interface AaqeTeamMember {
  name: string;
  title: string;
  affiliation: string;
}

export interface AaqeTeamSection {
  heading: string;
  members: AaqeTeamMember[];
}

export const AAQE_WORKING_TEAM: AaqeTeamMember[] = [
  {
    name: 'Pawan Gupta, Ph.D.',
    title: 'Research Scientist, Principal Investigator',
    affiliation: 'NASA Goddard Space Flight Center',
  },
  {
    name: 'Junhyeon Seo, Ph.D.',
    title: 'Assistant Research Scientist',
    affiliation: 'Morgan State University, GESTAR II, NASA Goddard Space Flight Center',
  },
  {
    name: 'Alqamah Sayeed, Ph.D.',
    title: 'Air Quality Scientist',
    affiliation: 'University of Alabama Huntsville, NASA Marshall Space Flight Center',
  },
  {
    name: 'Ahmed Khan Salman, Ph.D.',
    title: 'Postdoctoral Research Scientist',
    affiliation: 'ERT, GESTAR II, NASA Goddard Space Flight Center',
  },
  {
    name: 'Sujan Neupane',
    title: 'Faculty Research Assistant',
    affiliation: 'UMBC, GESTAR II, NASA Goddard Space Flight Center',
  },
  {
    name: 'Avinash Telagamsetti',
    title: 'Software Developer',
    affiliation: 'UMBC, GESTAR II, NASA Goddard Space Flight Center',
  },
];

export const AAQE_SUPPORTING_TEAM: AaqeTeamMember[] = [
  {
    name: 'Robert C. Levy, Ph.D.',
    title: 'Atmospheric Scientist, Aerosol Retrieval Expert',
    affiliation: 'NASA Goddard Space Flight Center',
  },
  {
    name: 'Catherine Fox',
    title: 'Air Quality Program Analyst',
    affiliation: 'U.S. Department of State, Office of Environmental Quality',
  },
  {
    name: 'Andrew Clark',
    title: 'Chief for Chemicals, Air Quality, and Waste Management',
    affiliation: 'U.S. Department of State',
  },
];

export const AAQE_COLLABORATORS: AaqeTeamMember[] = [
  { name: 'Kimber Scavo', title: '', affiliation: 'U.S. Department of State' },
  { name: 'Kevin Daucher', title: '', affiliation: 'U.S. Department of State' },
  { name: 'Deo Okure', title: '', affiliation: 'Makerere University, AirQo, Uganda' },
  {
    name: 'Didier Ntwali, Ph.D.',
    title: '',
    affiliation: 'Rwanda Climate Observatory, Rwanda',
  },
  { name: 'Aderiana Mbandi, Ph.D.', title: '', affiliation: 'Africa Office, UNEP' },
  { name: 'Charles Sebukeera', title: '', affiliation: 'Africa Office, UNEP' },
  {
    name: 'Jennifer C. Wei, Ph.D.',
    title: '',
    affiliation: 'GES DISC, NASA Goddard Space Flight Center',
  },
  {
    name: 'Melanie Follette Cook, Ph.D.',
    title: '',
    affiliation: 'ARSET, NASA Goddard Space Flight Center',
  },
];

export const AAQE_TEAM_SECTIONS: AaqeTeamSection[] = [
  { heading: 'Working Team', members: AAQE_WORKING_TEAM },
  { heading: 'Supporting Team Members', members: AAQE_SUPPORTING_TEAM },
  { heading: 'Collaborators', members: AAQE_COLLABORATORS },
];
