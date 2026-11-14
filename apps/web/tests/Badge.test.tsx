import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { Badge } from '@/components/Badge';
import { BADGE_KINDS, badgeKind, provenanceProps } from '@/components/badge-model';
import { useAppStore } from '@/store/app';

describe('<Badge>', () => {
  beforeEach(() => useAppStore.getState().reset());

  it.each(BADGE_KINDS)('renders the %s pill with an accessible name', (kind) => {
    render(<Badge kind={kind} source="Somewhere" subject="Lake area" />);
    const trigger = screen.getByRole('button', { name: new RegExp(`^${kind}: Lake area`, 'i') });
    expect(trigger).toHaveAttribute('data-badge', kind);
    expect(trigger).toHaveTextContent(new RegExp(kind, 'i'));
  });

  it('accepts contract values (MEASURED → measured)', () => {
    expect(badgeKind('MEASURED')).toBe('measured');
    render(<Badge kind="MODELLED" />);
    expect(screen.getByRole('button', { name: /modelled/i })).toHaveAttribute('data-badge', 'modelled');
  });

  it('opens a popover with source, method and uncertainty on click', async () => {
    const user = userEvent.setup();
    render(
      <Badge kind="measured" source="NISAR GCOV via ASF" method="γ0 HH, water < −18 dB" uncertainty="± 0.3 km²" />,
    );
    await user.click(screen.getByRole('button', { name: /measured/i }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('NISAR GCOV via ASF');
    expect(dialog).toHaveTextContent('γ0 HH, water < −18 dB');
    expect(dialog).toHaveTextContent('± 0.3 km²');
    expect(dialog).toHaveTextContent(/directly from a satellite product/i);
  });

  it('opens with the keyboard and shows the product ID only in Experts mode', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Badge kind="measured" source="S" productId="NISAR_L2_PR_GCOV_X" />);
    await user.tab();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('dialog')).not.toHaveTextContent('NISAR_L2_PR_GCOV_X');
    unmount();

    useAppStore.getState().setLevel('experts');
    render(<Badge kind="measured" source="S" productId="NISAR_L2_PR_GCOV_X" />);
    await user.click(screen.getByRole('button', { name: /measured/i }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('NISAR_L2_PR_GCOV_X');
  });

  it('flags placeholders as not a result', async () => {
    const user = userEvent.setup();
    render(
      <Badge
        {...provenanceProps({
          badge: 'ILLUSTRATIVE',
          source: 'Fixture',
          placeholder: true,
          method: '',
          uncertainty: '',
        })}
      />,
    );
    await user.click(screen.getByRole('button', { name: /illustrative/i }));
    expect(await screen.findByRole('dialog')).toHaveTextContent(/placeholder: not a result/i);
  });
});
