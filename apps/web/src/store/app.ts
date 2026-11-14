import { create } from 'zustand';

/**
 * The single UI store (docs/04 §9). Read it with selectors, e.g. `useAppStore(s => s.swipe)`,
 * especially inside the R3F Canvas, so only the subscribed component re-renders.
 * scene-3d may request new fields from frontend-ui; do not add them ad hoc.
 */

export const LAYER_IDS = ['basemap', 'radar', 'mask', 'change', 'flowpath', 'flood', 'villages', 'cropland'] as const;
export type LayerId = (typeof LAYER_IDS)[number];

export const ACTS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
export type Act = (typeof ACTS)[number];

export type Mode = 'intro' | 'story' | 'watch';
export type Level = 'everyone' | 'experts';
export type Pol = 'HH' | 'HV' | 'RGB';
export type FloodMode = 'hand' | 'anuga';
export type DurationH = 6 | 12 | 24;
export type Quality = 'high' | 'medium' | 'low' | '2d';

export type FloodState = {
  mode: FloodMode;
  volumeM3: number;
  durationH: DurationH;
  scenarioId?: string;
};

export type AppState = {
  mode: Mode;
  act: Act;
  level: Level;
  date: string; // ISO acquisition date
  layers: Record<LayerId, boolean>;
  pol: Pol;
  swipe: number; // 0..1
  flood: FloodState;
  damId: string;
  quality: Quality;
  reducedMotion: boolean;
};

/** A partial update where nested objects may also be partial (URL hydration, act configs, Tour). */
export type StatePatch = Omit<Partial<AppState>, 'layers' | 'flood'> & {
  layers?: Partial<Record<LayerId, boolean>>;
  flood?: Partial<FloodState>;
};

export type AppActions = {
  setMode: (mode: Mode) => void;
  setAct: (act: Act) => void;
  setLevel: (level: Level) => void;
  setDate: (date: string) => void;
  setLayer: (id: LayerId, on: boolean) => void;
  toggleLayer: (id: LayerId) => void;
  setLayers: (layers: Partial<Record<LayerId, boolean>>) => void;
  setPol: (pol: Pol) => void;
  setSwipe: (swipe: number) => void;
  setFlood: (flood: Partial<FloodState>) => void;
  setDamId: (damId: string) => void;
  setQuality: (quality: Quality) => void;
  setReducedMotion: (reducedMotion: boolean) => void;
  /** Apply a partial state (URL hydration, act configs, Tour). */
  hydrate: (patch: StatePatch) => void;
  reset: () => void;
};

export type AppStore = AppState & AppActions;

export const VOLUME_MAX_M3 = 200e6;
export const LEVEL_STORAGE_KEY = 'dwd.level';

export const DEFAULT_LAYERS: Record<LayerId, boolean> = {
  basemap: true,
  radar: true,
  mask: false,
  change: false,
  flowpath: false,
  flood: false,
  villages: false,
  cropland: false,
};

export const DEFAULT_STATE: AppState = {
  mode: 'intro',
  act: 1,
  level: 'everyone',
  date: '2026-06-19',
  layers: DEFAULT_LAYERS,
  pol: 'HH',
  swipe: 0.5,
  flood: { mode: 'hand', volumeM3: 21e6, durationH: 12 },
  damId: 'mellegue',
  quality: 'high',
  reducedMotion: false,
};

export const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

function readStoredLevel(): Level | undefined {
  try {
    const v = globalThis.localStorage?.getItem(LEVEL_STORAGE_KEY);
    return v === 'everyone' || v === 'experts' ? v : undefined;
  } catch {
    return undefined;
  }
}

function storeLevel(level: Level): void {
  try {
    globalThis.localStorage?.setItem(LEVEL_STORAGE_KEY, level);
  } catch {
    /* private mode / blocked storage: level just won't persist */
  }
}

function prefersReducedMotion(): boolean {
  try {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
}

export function initialState(): AppState {
  return {
    ...DEFAULT_STATE,
    layers: { ...DEFAULT_LAYERS },
    flood: { ...DEFAULT_STATE.flood },
    level: readStoredLevel() ?? DEFAULT_STATE.level,
    reducedMotion: prefersReducedMotion(),
  };
}

export const useAppStore = create<AppStore>()((set) => ({
  ...initialState(),
  setMode: (mode) => set({ mode }),
  setAct: (act) => set({ act }),
  setLevel: (level) => {
    storeLevel(level);
    set({ level });
  },
  setDate: (date) => set({ date }),
  setLayer: (id, on) => set((s) => ({ layers: { ...s.layers, [id]: on } })),
  toggleLayer: (id) => set((s) => ({ layers: { ...s.layers, [id]: !s.layers[id] } })),
  setLayers: (layers) => set((s) => ({ layers: { ...s.layers, ...layers } })),
  setPol: (pol) => set({ pol }),
  setSwipe: (swipe) => set({ swipe: clamp01(swipe) }),
  setFlood: (flood) =>
    set((s) => {
      const next = { ...s.flood, ...flood };
      next.volumeM3 = Math.min(VOLUME_MAX_M3, Math.max(0, next.volumeM3));
      return { flood: next };
    }),
  setDamId: (damId) => set({ damId }),
  setQuality: (quality) => set({ quality }),
  setReducedMotion: (reducedMotion) => set({ reducedMotion }),
  hydrate: (patch) =>
    set((s) => {
      const { layers, flood, ...rest } = patch;
      return {
        ...rest,
        ...(rest.swipe !== undefined ? { swipe: clamp01(rest.swipe) } : {}),
        layers: layers ? { ...s.layers, ...layers } : s.layers,
        flood: flood ? { ...s.flood, ...flood } : s.flood,
      };
    }),
  reset: () => set(initialState()),
}));

export const isAct = (n: number): n is Act => Number.isInteger(n) && n >= 1 && n <= 9;
export const isLayerId = (s: string): s is LayerId => (LAYER_IDS as readonly string[]).includes(s);
