/**
 * Intro runtime: the clock and state machine of the cinematic intro, shared by the DOM overlay
 * (features/intro) and the R3F director (scene/intro). Plain TypeScript, no three.js and no React
 * state, so the overlay can live in a small chunk and nothing re-renders per frame.
 *
 * Timings, captions and hotspots are ported 1:1 from reference/NISAR-HydroStress-Cinematic-Intro.html
 * (`T_HERO`, `D_FUSE`, `D_FLASH`, `D_END`, `CHAPTERS`, `HOTS`, `.cap[data-s/e]`).
 */

export type IntroMode = 'loading' | 'intro' | 'explore' | 'dive' | 'done';

export const T_HERO = 11.2;
/** Dive timeline after "Start the mission". */
export const D_FUSE = 2.5;
export const D_FLASH = 3.1;
export const D_END = 3.4;

export const CHAPTERS: readonly { name: string; s: number }[] = [
  { name: 'Approach', s: 0 },
  { name: 'Deploy', s: 3.4 },
  { name: 'Orbit', s: 6.8 },
  { name: 'Scan', s: 9.2 },
];

export type Caption = {
  tl: 'intro' | 'dive';
  s: number;
  e: number;
  kicker?: string;
  big?: string;
  mid?: string;
  sub?: string;
};

/** docs/05 §1: caption 4 and the dive caption changed vs the prototype. */
export const CAPTIONS: readonly Caption[] = [
  { tl: 'intro', s: 0.5, e: 3.3, kicker: 'NASA · ISRO', big: 'NISAR', sub: 'Synthetic Aperture Radar' },
  { tl: 'intro', s: 3.7, e: 6.5, mid: 'Deploying the 12-metre reflector', sub: 'a 9-metre boom unfolds in orbit' },
  { tl: 'intro', s: 6.9, e: 9.0, mid: '747 km above Earth', sub: 'the whole planet every 12 days' },
  { tl: 'intro', s: 9.3, e: 11.4, mid: 'L-band radar · 24 cm wavelength', sub: 'it sees through clouds, day and night' },
  { tl: 'dive', s: 0.2, e: 2.5, mid: 'Riding the pulse down to the Mellègue dam, Kef' },
  { tl: 'dive', s: 2.4, e: 3.6, kicker: 'synthesizing aperture…' },
];

export type Hotspot = { title: string; pos: readonly [number, number, number]; text: string };

export const HOTSPOTS: readonly Hotspot[] = [
  {
    title: 'Deployable reflector',
    pos: [0, 4.9, -2.8],
    text: 'A 12-metre gold-plated wire-mesh reflector. Both radars bounce their beams off it. It was stowed for launch and unfurled in orbit.',
  },
  {
    title: 'Deployable boom',
    pos: [0.7, 3.0, 0.42],
    text: 'The 9-metre boom holds the reflector far from the spacecraft so the beam can be steered across a wide swath.',
  },
  {
    title: 'Radar instrument structure',
    pos: [0, 1.35, 0],
    text: 'Houses the L-band SAR (NASA/JPL, 24 cm) and S-band SAR (ISRO, ~10 cm) feeds. SweepSAR scans the beam to cover a 242 km swath.',
  },
  {
    title: 'Spacecraft bus',
    pos: [0, 0, 0.58],
    text: 'ISRO-built bus: power, attitude control and propulsion. A NASA-supplied Ka-band link sends the large radar data volumes to the ground.',
  },
  {
    title: 'Solar arrays',
    pos: [-3, 0, 0.2],
    text: 'Provide the substantial power both radars need to transmit their own microwave pulses, which lets NISAR image day and night.',
  },
];

/** Lens flare elements: [position along the sun→centre axis, size px, colour]. */
export const FLARE: readonly (readonly [number, number, string])[] = [
  [1, 120, 'rgba(255,240,210,.35)'],
  [0.55, 26, 'rgba(120,220,255,.25)'],
  [0.2, 60, 'rgba(255,160,90,.12)'],
  [-0.25, 18, 'rgba(160,255,200,.25)'],
  [-0.6, 90, 'rgba(90,150,255,.10)'],
  [-1, 34, 'rgba(255,120,200,.14)'],
];

export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
/** Prototype `sm(a, b, x)`: smoothstep. */
export const sm = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Debug seek from the URL: `/?t=<s>` freezes the intro, `/?dive=<s>` freezes the dive. */
export type Seek = { kind: 'intro' | 'dive'; time: number } | null;

export function parseSeek(search: string): Seek {
  const q = new URLSearchParams(search);
  for (const kind of ['dive', 't'] as const) {
    const raw = q.get(kind);
    if (raw === null || raw.trim() === '') continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) continue;
    return kind === 'dive' ? { kind: 'dive', time: Math.min(n, D_FLASH - 0.02) } : { kind: 'intro', time: Math.min(n, 60) };
  }
  return null;
}

type Listener = () => void;
type EventName = 'frame' | 'ready' | 'diveEnd' | 'mode';

/**
 * Mutable singleton. The director (scene) writes camera-derived outputs (flare, hotspots);
 * the overlay reads them in its `frame` listener and writes the DOM through refs.
 */
export class IntroRuntime {
  mode: IntroMode = 'loading';
  t = 0;
  td = 0;
  playing = false;
  /** Hero layout (title + CTA) vs plain explore (facts card). */
  hero = false;
  autoRot = true;
  dragging = false;
  hsSel = -1;
  reduced = false;
  /** Debug seek: frame frozen at a given time (no clock advance). */
  frozen = false;
  seek: Seek = null;
  /** Bumped on every (re)start so the director re-initialises its camera. */
  epoch = 0;
  diveEnded = false;

  // readiness (loader)
  stageReady = false;
  dataReady = false;
  assetsIdle = true;
  /** Terrain textures decoded and uploaded: the dive holds the flash until this is true. */
  terrainReady = false;

  // pointer (mouse parallax), −0.5..0.5
  mx = 0;
  my = 0;

  // outputs written by the director each frame
  readonly flareX = new Float32Array(FLARE.length);
  readonly flareY = new Float32Array(FLARE.length);
  flareA = 0;
  readonly hotX = new Float32Array(HOTSPOTS.length);
  readonly hotY = new Float32Array(HOTSPOTS.length);
  readonly hotVis = new Uint8Array(HOTSPOTS.length);

  private listeners = new Map<EventName, Set<Listener>>();

  on(name: EventName, fn: Listener): () => void {
    let set = this.listeners.get(name);
    if (!set) this.listeners.set(name, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }

  emit(name: EventName): void {
    this.listeners.get(name)?.forEach((fn) => fn());
  }

  get ready(): boolean {
    return this.stageReady && this.dataReady && this.assetsIdle;
  }

  setReadiness(patch: Partial<Pick<IntroRuntime, 'stageReady' | 'dataReady' | 'assetsIdle' | 'terrainReady'>>): void {
    const was = this.ready;
    Object.assign(this, patch);
    if (!was && this.ready) this.emit('ready');
  }

  private setMode(mode: IntroMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.emit('mode');
  }

  /** Back to the loader state (route `/` mounted). */
  reset(seek: Seek, reduced: boolean): void {
    this.seek = seek;
    this.reduced = reduced;
    this.frozen = seek !== null;
    this.t = 0;
    this.td = 0;
    this.playing = false;
    this.hero = false;
    this.autoRot = !reduced;
    this.hsSel = -1;
    this.diveEnded = false;
    this.epoch++;
    this.setMode('loading');
  }

  /** Loader done: start the cinematic (or jump to the hero under reduced motion). */
  start(): void {
    if (this.mode !== 'loading') return;
    this.playing = true;
    this.setMode('intro');
  }

  togglePlay(): void {
    if (this.mode !== 'intro' || this.frozen) return;
    this.playing = !this.playing;
    this.emit('mode');
  }

  seekChapter(s: number): void {
    if (this.mode !== 'intro' || this.frozen) return;
    this.t = s;
    this.playing = true;
    this.emit('mode');
  }

  enterHero(): void {
    this.hero = true;
    this.autoRot = !this.reduced;
    this.hsSel = -1;
    this.setMode('explore');
  }

  /** Secondary CTA: explore the satellite without the hero layout. */
  explore(): void {
    if (this.mode !== 'explore') return;
    this.hero = false;
    this.emit('mode');
  }

  backToHero(): void {
    if (this.mode !== 'explore') return;
    this.hero = true;
    this.hsSel = -1;
    this.emit('mode');
  }

  pauseAuto(): void {
    if (this.autoRot) {
      this.autoRot = false;
      this.emit('mode');
    }
  }

  resumeAuto(): void {
    this.autoRot = true;
    this.emit('mode');
  }

  startMission(): void {
    if (this.mode !== 'explore') return;
    this.hsSel = -1;
    this.hero = false;
    this.td = 0;
    this.diveEnded = false;
    this.setMode('dive');
  }

  /**
   * Advance the clock (prototype `frame()` top half). The scene swap ('diveEnd') fires at D_FLASH,
   * when the white flash is fully opaque, so the terrain, post-processing and Act route mount
   * unseen; the flash then fades from D_END as in the prototype. While the terrain is not ready
   * the dive holds just before D_FLASH (flash ≈ 1), so no blank frame can show.
   */
  advance(dt: number): void {
    if (this.frozen) return;
    if (this.mode === 'intro' && this.playing) {
      this.t += dt;
      if (this.t >= T_HERO) this.enterHero();
    } else if (this.mode === 'dive' || this.mode === 'done') {
      const next = this.td + dt;
      this.td = !this.terrainReady && next >= D_FLASH ? Math.max(this.td, D_FLASH - 1e-3) : next;
      if (this.td >= D_FLASH && !this.diveEnded) {
        this.diveEnded = true;
        this.emit('diveEnd');
      }
      if (this.mode === 'dive' && this.td > D_END + 1) this.setMode('done');
    }
  }

  /** White flash opacity for the dive (prototype `#flash`). */
  flash(): number {
    if (this.mode !== 'dive' && !(this.mode === 'done' && this.td < D_END + 1)) return 0;
    return Math.min(sm(D_FLASH - 0.6, D_FLASH, this.td), 1 - sm(D_END, D_END + 0.9, this.td));
  }
}

export const intro = new IntroRuntime();
