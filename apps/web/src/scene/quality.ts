import type { Quality } from '@/store/app';

/** Quality tiers (docs/04 §7.3). `segments` = terrain subdivisions along the long (east–west) side. */
export type Tier = { segments: number; dpr: number; vignette: boolean; noise: boolean; bloom: boolean };

export const TIERS: Record<Exclude<Quality, '2d'>, Tier> = {
  high: { segments: 512, dpr: 2, vignette: true, noise: true, bloom: true },
  medium: { segments: 384, dpr: 1.5, vignette: true, noise: false, bloom: false },
  low: { segments: 256, dpr: 1, vignette: false, noise: false, bloom: false },
};

export const lowerTier = (q: Quality): Quality => (q === 'high' ? 'medium' : q === 'medium' ? 'low' : q);
export const raiseTier = (q: Quality): Quality => (q === 'low' ? 'medium' : q === 'medium' ? 'high' : q);

export function hasWebGL2(): boolean {
  try {
    const c = document.createElement('canvas');
    const ok = Boolean(c.getContext('webgl2'));
    c.width = c.height = 0;
    return ok;
  } catch {
    return false;
  }
}
