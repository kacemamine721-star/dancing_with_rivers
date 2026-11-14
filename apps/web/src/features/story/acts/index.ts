import type { Act } from '@/store/app';
import type { ActConfig } from '../types';
import { act1 } from './act1';
import { act2 } from './act2';
import { act3 } from './act3';
import { act4 } from './act4';
import { act5 } from './act5';
import { act6 } from './act6';
import { act7 } from './act7';
import { act8 } from './act8';
import { act9 } from './act9';

export const ACT_CONFIGS: Record<Act, ActConfig> = {
  1: act1,
  2: act2,
  3: act3,
  4: act4,
  5: act5,
  6: act6,
  7: act7,
  8: act8,
  9: act9,
};

export { act1, act2, act3, act4, act5, act6, act7, act8, act9 };
