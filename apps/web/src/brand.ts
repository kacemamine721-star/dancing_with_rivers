/**
 * Product naming. Every place that shows the product name reads it from here,
 * so the pending "HydroStress" vs "Dancing with Dams" decision is a one-line change.
 */
export const BRAND = { product: 'HydroStress', project: 'Dancing with Dams' } as const;

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
