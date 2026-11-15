import type { BadgeProps } from '@/components/Badge';
import type { FloodState, LayerId, ShotId } from '@/store/app';

import type { FactId } from './facts';

/**
 * Story acts are data (docs/04, frontend-ui rules): camera, date, layers, swipe, flood defaults,
 * Try-it actions and copy all live in `acts/actN.ts`. Story.tsx only applies them.
 */

/** One state change a Try-it chip (or an act entry) performs. Applied by `applyAction`. */
export type ActAction =
  | { kind: 'shot'; shot: ShotId }
  | { kind: 'date'; date: string }
  /** Before/after radar swipe: `date` fills the left side; `null` turns the swipe off. */
  | { kind: 'compare'; date: string | null; swipe?: number }
  | { kind: 'swipe'; value: number }
  /** `on` omitted = toggle. */
  | { kind: 'layer'; layer: LayerId; on?: boolean }
  | { kind: 'flood'; flood: Partial<FloodState> }
  /** In-app route (Dam Watch, Methods…). */
  | { kind: 'navigate'; to: string };

export interface TryIt {
  label: string;
  /** Applied in order. */
  actions: ActAction[];
  /** Accessible description / tooltip. */
  hint?: string;
}

/**
 * Where a card badge takes its provenance from: a manifest layer, a bundle file, or static
 * REPORTED/ILLUSTRATIVE text (for facts that are not in the bundle, with their press source).
 */
export type BadgeSpec =
  | { from: 'layer'; layer: string; subject: string }
  | {
      from: 'file';
      file: 'reservoir_area' | 'alerts' | 'hand_lut' | 'impacts' | 'level_volume' | 'anuga';
      subject: string;
    }
  | ({ from: 'static' } & BadgeProps & { subject: string });

/** Act-specific widgets rendered next to the card. */
export type WidgetId =
  | 'swipe'
  | 'scrubber'
  | 'reservoirChart'
  | 'corridor'
  | 'alerts'
  | 'scenario'
  | 'levelVolume'
  | 'catchment';

/** The complete stage an act sets on entry: every layer is listed, so nothing leaks between acts. */
export interface ActStage {
  shot: ShotId;
  date: string;
  /** `null` = no swipe. */
  compareDate: string | null;
  swipe?: number;
  layers: Record<LayerId, boolean>;
  flood?: Partial<FloodState>;
}

export interface ActConfig {
  act: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  /** Short name for the progress rail. */
  short: string;
  kicker: string;
  title: string;
  /**
   * Everyone copy. `{fact.id}` placeholders are filled from the data bundle (facts.ts), so no
   * number that exists in the bundle is typed by hand.
   */
  body: string;
  /** Experts copy (same placeholders). */
  expertBody: string;
  /** Telemetry rail under the body (Everyone + Experts). */
  facts: FactId[];
  /** Extra facts shown in Experts mode. */
  expertFacts?: FactId[];
  badges: BadgeSpec[];
  stage: ActStage;
  tryIt: TryIt[];
  widgets: WidgetId[];
}
