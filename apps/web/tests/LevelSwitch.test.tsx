import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { LevelSwitch } from '@/components/LevelSwitch';
import { LEVEL_STORAGE_KEY, useAppStore } from '@/store/app';

describe('<LevelSwitch>', () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.getState().reset();
  });

  it('shows the current level as pressed', () => {
    render(<LevelSwitch />);
    expect(screen.getByRole('radio', { name: /simplified/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /advanced/i })).toHaveAttribute('aria-checked', 'false');
  });

  it('switches level in the store and persists it', async () => {
    const user = userEvent.setup();
    render(<LevelSwitch />);
    await user.click(screen.getByRole('radio', { name: /advanced/i }));
    expect(useAppStore.getState().level).toBe('experts');
    expect(localStorage.getItem(LEVEL_STORAGE_KEY)).toBe('experts');
    expect(screen.getByRole('radio', { name: /advanced/i })).toHaveAttribute('aria-checked', 'true');
  });

  it('keeps one level selected when the active item is clicked again', async () => {
    const user = userEvent.setup();
    render(<LevelSwitch />);
    await user.click(screen.getByRole('radio', { name: /simplified/i }));
    expect(useAppStore.getState().level).toBe('everyone');
  });

  it('is keyboard operable (arrow keys move, space selects)', async () => {
    const user = userEvent.setup();
    render(<LevelSwitch />);
    await user.tab();
    expect(screen.getByRole('radio', { name: /simplified/i })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: /advanced/i })).toHaveFocus();
    await user.keyboard(' ');
    expect(useAppStore.getState().level).toBe('experts');
  });
});
