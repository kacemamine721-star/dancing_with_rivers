import type { BadgeProps } from '@/components/Badge';

/** Badge kinds, copy and helpers (kept apart from the component for fast refresh). */
export type BadgeKind = 'measured' | 'reported' | 'modelled' | 'illustrative';
export type ContractBadge = 'MEASURED' | 'REPORTED' | 'MODELLED' | 'ILLUSTRATIVE';

export const BADGE_KINDS: readonly BadgeKind[] = ['measured', 'reported', 'modelled', 'illustrative'];

/** Map a contract value ("MEASURED") to a Badge kind. */
export function badgeKind(value: ContractBadge | BadgeKind): BadgeKind {
  return value.toLowerCase() as BadgeKind;
}

// TODO(i18n, M4): move to locales/en/common.json once i18next lands.
export const BADGE_COPY: Record<BadgeKind, { label: string; meaning: string }> = {
  measured: { label: 'Measured', meaning: 'Directly from a satellite product.' },
  reported: { label: 'Reported', meaning: 'From an official or press report.' },
  modelled: { label: 'Modelled', meaning: 'Output of our models (HAND, ANUGA, estimates).' },
  illustrative: { label: 'Illustrative', meaning: 'Simulated or artistic, not data.' },
};

/** Convenience: spread a contract object carrying provenance (badge, source, method, uncertainty, placeholder). */
export function provenanceProps(p: {
  badge: ContractBadge;
  source: string;
  method?: string | undefined;
  uncertainty?: string | undefined;
  placeholder?: boolean | undefined;
  date?: string | null | undefined;
  product_id?: string | null | undefined;
}): BadgeProps {
  return {
    kind: p.badge,
    source: p.source,
    ...(p.method ? { method: p.method } : {}),
    ...(p.uncertainty ? { uncertainty: p.uncertainty } : {}),
    ...(p.placeholder ? { placeholder: true } : {}),
    ...(p.date ? { date: p.date } : {}),
    ...(p.product_id ? { productId: p.product_id } : {}),
  };
}
