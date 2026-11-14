import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

/** Tokens → utilities (docs/04 §3.2). Values come from CSS variables in src/styles/tokens.css. */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        ink: 'var(--ink)',
        mute: 'var(--mute)',
        teal: { DEFAULT: 'var(--teal)', dim: 'var(--teal-dim)' },
        mag: 'var(--mag)',
        water: 'var(--water)',
        flood: { 1: 'var(--flood-1)', 2: 'var(--flood-2)', 3: 'var(--flood-3)', 4: 'var(--flood-4)' },
        alert: 'var(--alert)',
        danger: 'var(--danger)',
        ok: 'var(--ok)',
        model: 'var(--model)',
        glass: 'var(--glass-bg)',
        hairline: 'var(--hairline)',
        'on-teal': 'var(--on-teal)',
        badge: {
          measured: 'var(--badge-measured)',
          reported: 'var(--badge-reported)',
          modelled: 'var(--badge-modelled)',
          illustrative: 'var(--badge-illustrative)',
        },
      },
      fontFamily: {
        display: ['Bowlby One', 'Space Grotesk', 'system-ui', 'sans-serif'],
        sans: ['Space Grotesk', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
      borderRadius: {
        card: 'var(--radius-card)',
        pill: 'var(--radius-pill)',
      },
      transitionTimingFunction: {
        cine: 'var(--ease-cine)',
      },
      transitionDuration: {
        ui: '200ms',
        cam: '900ms',
      },
      backdropBlur: {
        glass: 'var(--glass-blur)',
      },
      letterSpacing: {
        btn: '0.14em',
        kick: '0.16em',
        badge: '0.18em',
      },
      keyframes: {
        'pulse-ring': {
          '0%': { boxShadow: '0 0 0 0 rgba(95,243,255,.55)' },
          '100%': { boxShadow: '0 0 0 18px rgba(95,243,255,0)' },
        },
      },
      animation: {
        'pulse-ring': 'pulse-ring 1.2s var(--ease-cine) 1',
      },
    },
  },
  plugins: [animate],
} satisfies Config;
