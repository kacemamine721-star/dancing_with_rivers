import type { BadgeProps } from '@/components/Badge';
import type { Act, LayerId, ShotId } from '@/store/app';

export interface TryItAction {
  label: string;
  action: () => void;
}

export interface ExpertStat {
  label: string;
  value: string;
  unit?: string;
  badge?: BadgeProps;
}

export interface ActConfig {
  act: Act;
  kicker: string;
  title: string;
  body: string;
  expertBody: string;
  expertStats?: ExpertStat[];
  badges: BadgeProps[];
  defaultShot: ShotId;
  defaultDate?: string;
  compareDate?: string | null;
  defaultLayers?: Partial<Record<LayerId, boolean>>;
  tryIt?: TryItAction[];
}
