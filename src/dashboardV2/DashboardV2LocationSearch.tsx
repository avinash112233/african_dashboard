import { useMemo, useState } from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import {
  DASHBOARD_V2_LOCATIONS,
  type DashboardV2Location,
} from './locations';

interface DashboardV2LocationSearchProps {
  selectedLabel?: string;
  onSelect: (location: DashboardV2Location) => void;
}

export default function DashboardV2LocationSearch({
  selectedLabel,
  onSelect,
}: DashboardV2LocationSearchProps) {
  const [inputValue, setInputValue] = useState('');

  const selectedLocation = useMemo(
    () => DASHBOARD_V2_LOCATIONS.find((loc) => loc.label === selectedLabel) ?? null,
    [selectedLabel]
  );

  return (
    <Autocomplete
      className="dashboard-v2-location-search"
      size="small"
      options={DASHBOARD_V2_LOCATIONS}
      value={selectedLocation}
      inputValue={inputValue}
      onInputChange={(_event, value) => setInputValue(value)}
      onChange={(_event, value) => {
        if (value) onSelect(value);
      }}
      getOptionLabel={(option) => option.label}
      groupBy={(option) => option.country}
      isOptionEqualToValue={(option, value) => option.id === value.id}
      noOptionsText="No matching cities"
      renderInput={(params) => (
        <TextField
          {...params}
          placeholder="Search city…"
          aria-label="Search map location"
          InputProps={{
            ...params.InputProps,
            startAdornment: (
              <>
                <i className="bi bi-search dashboard-v2-location-search-icon" aria-hidden="true" />
                {params.InputProps.startAdornment}
              </>
            ),
          }}
        />
      )}
      slotProps={{
        popper: { className: 'dashboard-v2-location-search-popper' },
      }}
    />
  );
}
