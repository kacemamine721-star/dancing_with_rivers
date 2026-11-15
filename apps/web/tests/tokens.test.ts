import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { hexToRgb01, tokens } from '@/styles/tokens';

const css = readFileSync(resolve(__dirname, '../src/styles/tokens.css'), 'utf8');
const cssVar = (name: string): string | undefined =>
  new RegExp(`--${name}:\\s*([^;]+);`).exec(css)?.[1]?.trim().toLowerCase();

describe('design tokens', () => {
  it('tokens.ts (ui) matches tokens.css', () => {
    const c = tokens.ui;
    const pairs: Array<[string, string]> = [
      ['bg', c.bg],
      ['ink', c.ink],
      ['mute', c.mute],
      ['teal', c.teal],
      ['teal-dim', c.tealDim],
      ['mag', c.mag],
      ['water', c.water],
      ['flood-1', c.flood[0]],
      ['flood-2', c.flood[1]],
      ['flood-3', c.flood[2]],
      ['flood-4', c.flood[3]],
      ['alert', c.alert],
      ['danger', c.danger],
      ['ok', c.ok],
      ['model', c.model],
      ['glass-bg', c.glassBg],
      ['on-teal', c.onTeal],
    ];
    for (const [name, value] of pairs) expect(cssVar(name), name).toBe(value.toLowerCase());
    expect(cssVar('glass-blur')).toBe(`${tokens.glassBlurPx}px`);
  });

  it('keeps --mute at the AA value for the light theme', () => {
    expect(cssVar('mute')).toBe('#545985');
  });

  it('converts hex to shader rgb', () => {
    expect(hexToRgb01('#ffffff')).toEqual([1, 1, 1]);
    expect(() => hexToRgb01('teal')).toThrow();
  });
});
