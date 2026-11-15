/**
 * Product naming. Every place that shows the product name reads it from here.
 * Decided 15 Nov 2026: the product is shown as "Dancing with the Rivers" (formerly HydroStress).
 */
export const BRAND = {
  product: 'Dancing with the Rivers',
  project: 'Dancing with the Rivers',
  tagline: 'NISAR radar · Mellègue dam · Tunisia',
} as const;

/**
 * Split a name for the two-tone wordmark (prototype: Hydro<b>Stress</b>).
 * CamelCase → split before the last capital; multi-word → highlight the last word.
 */
export function splitWordmark(name: string): [lead: string, accent: string] {
  const camel = /^(.*[a-z])([A-Z][a-z]+)$/.exec(name);
  if (camel && !name.includes(' ')) return [camel[1]!, camel[2]!];
  const i = name.lastIndexOf(' ');
  return i > 0 ? [name.slice(0, i + 1), name.slice(i + 1)] : [name, ''];
}
