import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Badge } from '@/components/Badge';
import { HonestyNote } from '@/components/HonestyNote';
import { Stat } from '@/components/Stat';

describe('<Stat>', () => {
  it('renders label, value, unit, sub and badge', () => {
    render(
      <Stat
        label="Released volume"
        value="21"
        unit="Mm³"
        sub="Reported by the ministry"
        badge={<Badge kind="reported" />}
      />,
    );
    expect(screen.getByText('Released volume')).toBeInTheDocument();
    expect(screen.getByText('21')).toBeInTheDocument();
    expect(screen.getByText('Mm³')).toBeInTheDocument();
    expect(screen.getByText('Reported by the ministry')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reported/i })).toBeInTheDocument();
  });

  it('clamps the progress bar and exposes it to assistive tech', () => {
    render(<Stat label="Lake area" value="3" progress={1.4} />);
    const bar = screen.getByRole('progressbar', { name: 'Lake area' });
    expect(bar).toHaveAttribute('aria-valuenow', '100');
  });

  it('omits the progress bar when not given', () => {
    render(<Stat label="Lake area" value="3" />);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});

describe('<HonestyNote>', () => {
  it('renders a labelled disclosure with its text', () => {
    render(
      <HonestyNote label="Scenario · not a forecast">
        Modelled with HAND. Sources: NASADEM, ESA WorldCover.
      </HonestyNote>,
    );
    const note = screen.getByRole('complementary', { name: 'Scenario · not a forecast' });
    expect(note).toHaveTextContent('Modelled with HAND');
  });
});
