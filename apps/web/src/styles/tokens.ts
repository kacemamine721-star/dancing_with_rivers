/**
 * Design tokens as a typed object (docs/04 §3.1).
 * - `color`: the 3D scene's night palette (shaders, canvas labels). Independent of the UI theme.
 * - `ui`: the light UI theme; must match src/styles/tokens.css (tests/tokens.test.ts enforces it).
 */
export const tokens = {
  color: {
    bg: '#03050a',
    ink: '#e9f1ff',
    mute: '#9aa7bd',
    teal: '#5ff3ff',
    tealDim: 'rgba(95, 243, 255, 0.18)',
    mag: '#ff4fd2',
    water: '#2f8fff',
    flood: ['#9be7ff', '#2f8fff', '#1b3a9e', '#120b4a'] as const,
    alert: '#ffb547',
    danger: '#ff5a5a',
    ok: '#6dffa8',
    model: '#b38cff',
    glassBg: 'rgba(8, 14, 24, 0.72)',
    hairline: 'rgba(233, 241, 255, 0.08)',
    onTeal: '#021014',
  },
  /** UI theme (light): must match src/styles/tokens.css; tests/tokens.test.ts enforces it. */
  ui: {
    bg: '#f4f0e6',
    paper: '#fbf8f1',
    ink: '#10136b',
    mute: '#545985',
    teal: '#1a22b4',
    tealDim: 'rgba(26, 34, 180, 0.16)',
    mag: '#d6336c',
    water: '#2b4ce0',
    flood: ['#9fb4ff', '#2b4ce0', '#1a22b4', '#0b0f5c'] as const,
    alert: '#b5520b',
    danger: '#c4262e',
    ok: '#1f7a4d',
    model: '#6a3fc2',
    glassBg: 'rgba(251, 248, 241, 0.9)',
    hairline: 'rgba(16, 19, 107, 0.14)',
    onTeal: '#f4f0e6',
  },
  badge: {
    measured: '#5ff3ff',
    reported: '#e9f1ff',
    modelled: '#b38cff',
    illustrative: '#9aa7bd',
  },
  glassBlurPx: 14,
  radius: { card: 22, pill: 999 },
  ease: { cine: [0.65, 0, 0.35, 1] as const },
  duration: { uiMs: 200, camMs: 900 },
  font: {
    display: "'Bowlby One', 'Space Grotesk', system-ui, sans-serif",
    sans: "'Space Grotesk', system-ui, -apple-system, 'Segoe UI', sans-serif",
    mono: "'JetBrains Mono', ui-monospace, 'SFMono-Regular', Consolas, monospace",
  },
} as const;

export type Tokens = typeof tokens;
export type BadgeKind = keyof typeof tokens.badge;

/** CSS variable names, for inline styles that must follow the theme. */
export const cssVar = {
  bg: 'var(--bg)',
  ink: 'var(--ink)',
  mute: 'var(--mute)',
  teal: 'var(--teal)',
  tealDim: 'var(--teal-dim)',
  mag: 'var(--mag)',
  water: 'var(--water)',
  alert: 'var(--alert)',
  danger: 'var(--danger)',
  ok: 'var(--ok)',
  model: 'var(--model)',
} as const;

/** Convert "#rrggbb" to a normalised [r, g, b] triple (0..1) for shader uniforms. */
export function hexToRgb01(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`Invalid hex colour: ${hex}`);
  return [parseInt(m[1]!, 16) / 255, parseInt(m[2]!, 16) / 255, parseInt(m[3]!, 16) / 255];
}
