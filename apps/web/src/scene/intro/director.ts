/**
 * Camera choreography of the intro (prototype `KEYS`, `uAt`, `buildDive`, `ORB`, spring camera,
 * mouse parallax, hero view offset, fov, beam / ripple / flare / hotspot updates). One `step(dt)`
 * = one prototype frame, so a debug seek can replay the exact history at a fixed 60 Hz.
 */
import {
  CatmullRomCurve3,
  type Object3D,
  type PerspectiveCamera,
  Ray,
  Sphere,
  Vector3,
} from 'three';

import {
  clamp,
  D_FLASH,
  D_FUSE,
  FLARE,
  HOTSPOTS,
  type IntroRuntime,
  sm,
} from '@/features/intro/runtime';
import { EC, easeIO, ER, type IntroWorld, SUN_DIR } from '@/scene/intro/world';

const P = (v: readonly [number, number, number]) => new Vector3(v[0], v[1], v[2]);

/** [time s, camera position, look-at] (prototype KEYS). */
export const KEYS: readonly (readonly [number, readonly [number, number, number], readonly [number, number, number]])[] = [
  [0, [8, 7, 82], [0, -5, -2]],
  [3.4, [13, 5, 24], [0, 1.5, -1]],
  [6.8, [8.5, 8.5, 9.5], [0, 3, -1.5]],
  [9.2, [-21, 3, 16], [-2, -5, -6]],
  [11.0, [-12, 5, 10], [0, 2, -1.3]],
];

const posC = new CatmullRomCurve3(KEYS.map((k) => P(k[1])), false, 'catmullrom', 0.5);
const lookC = new CatmullRomCurve3(KEYS.map((k) => P(k[2])), false, 'catmullrom', 0.5);

/** Curve parameter for intro time t (prototype `uAt`: eased first and last segments). */
export function uAt(t: number): number {
  if (t <= KEYS[0]![0]) return 0;
  for (let i = 0; i < KEYS.length - 1; i++) {
    const a = KEYS[i]![0];
    const b = KEYS[i + 1]![0];
    if (t <= b) {
      const f = (t - a) / (b - a);
      const fe = i === 0 ? sm(0, 1, f) * 0.6 + f * 0.4 : i === KEYS.length - 2 ? sm(0, 1, f) * 0.7 + f * 0.3 : f;
      return (i + fe) / (KEYS.length - 1);
    }
  }
  return 1;
}

/** Camera at intro time t (no spring, no parallax). */
export function introCamera(t: number, pos: Vector3, look: Vector3): void {
  const u = uAt(t);
  posC.getPoint(u, pos);
  lookC.getPoint(u, look);
}

/** Reduced motion: hold each chapter's key (cuts between chapters). */
export function chapterKey(t: number): number {
  let k = 0;
  for (let i = 0; i < KEYS.length; i++) if (t >= KEYS[i]![0]) k = i;
  return k;
}

export class IntroDirector {
  readonly camPos = new Vector3();
  readonly camLook = new Vector3();
  private readonly tgtPos = new Vector3();
  private readonly tgtLook = new Vector3();
  private springK = 4;
  private heroOff = 0;
  private smx = 0;
  private smy = 0;
  private prevMode = '';
  private epoch = -1;
  private diveP: CatmullRomCurve3 | null = null;
  private diveL: CatmullRomCurve3 | null = null;
  private readonly orb = { c: new Vector3(0, 2, -1.3), th: 0.6, ph: 1.15, r: 16, rT: 16 };
  private readonly v3 = new Vector3();
  private readonly sunW = SUN_DIR.clone().multiplyScalar(1500);
  private readonly ray = new Ray();
  private readonly earthSphere = new Sphere(EC, ER * 1.02);
  /** Reduced motion: last chapter key shown (a change triggers a crossfade cut). */
  chapter = -1;

  constructor(
    private readonly world: IntroWorld,
    private readonly rt: IntroRuntime,
  ) {}

  /** Re-start: camera at the first key. */
  reset(): void {
    introCamera(0, this.camPos, this.camLook);
    this.springK = 4;
    this.heroOff = 0;
    this.smx = this.smy = 0;
    this.diveP = this.diveL = null;
    this.chapter = -1;
    this.prevMode = this.rt.mode;
    this.world.earth.group.rotation.y = 0;
    this.world.earth.uniforms.time.value = 0;
    this.world.beam.uniforms.time.value = 0;
    this.world.stars.material.uniforms.time!.value = 0;
  }

  zoom(deltaY: number): void {
    this.orb.rT = clamp(this.orb.rT * (1 + deltaY * 0.001), 6, 34);
  }

  drag(dx: number, dy: number): void {
    this.orb.th -= dx * 0.006;
    this.orb.ph = clamp(this.orb.ph - dy * 0.005, 0.25, 2.6);
  }

  private enterHero(): void {
    const o = this.orb;
    const rel = this.v3.copy(this.camPos).sub(o.c);
    o.r = rel.length();
    o.rT = 16;
    o.ph = Math.acos(clamp(rel.y / o.r, -1, 1));
    o.th = Math.atan2(rel.x, rel.z);
  }

  private buildDive(): void {
    const { beamStart, beamEnd, tgtDir } = this.world.beam;
    const a = beamStart.clone().lerp(beamEnd, 0.45);
    const b = beamEnd.clone().addScaledVector(tgtDir, 0.9);
    this.diveP = new CatmullRomCurve3(
      [this.camPos.clone(), P([-5.5, 6.6, -1.4]), P([-0.4, 4.05, -2.6]), new Vector3(a.x - 0.5, a.y, a.z), b],
      false,
      'catmullrom',
      0.5,
    );
    this.diveL = new CatmullRomCurve3(
      [this.camLook.clone(), P([0, 4.1, -2.8]), P([-1, -8, -8]), beamEnd.clone(), beamEnd.clone().addScaledVector(tgtDir, -3)],
      false,
      'catmullrom',
      0.5,
    );
    this.springK = 7;
  }

  /** One prototype frame of camera + world animation (runtime clock already advanced). */
  step(dt: number, camera: PerspectiveCamera, width: number, height: number): void {
    const rt = this.rt;
    const w = this.world;
    if (rt.epoch !== this.epoch) {
      this.epoch = rt.epoch;
      this.reset();
    }
    if (rt.mode !== this.prevMode) {
      if (rt.mode === 'explore' && this.prevMode !== 'explore') this.enterHero();
      if (rt.mode === 'dive') this.buildDive();
      this.prevMode = rt.mode;
    }

    w.earth.uniforms.time.value += dt;
    w.beam.uniforms.time.value += dt;
    w.stars.material.uniforms.time!.value += dt;
    w.earth.group.rotation.y += dt * 0.006;
    w.nisar.setDeploy(rt.mode === 'intro' || rt.mode === 'loading' ? rt.t : 99);

    const mode = rt.mode;
    if (mode === 'intro' || mode === 'loading') {
      if (rt.reduced) {
        const k = chapterKey(rt.t);
        introCamera(KEYS[k]![0], this.tgtPos, this.tgtLook);
      } else {
        introCamera(rt.t, this.tgtPos, this.tgtLook);
        this.smx += (rt.mx - this.smx) * 0.05;
        this.smy += (rt.my - this.smy) * 0.05;
        const par = Math.max(0, 1 - rt.t / 9) * 2 + 0.06;
        this.tgtPos.x += this.smx * par;
        this.tgtPos.y -= this.smy * par * 0.6;
      }
    } else if (mode === 'dive' || mode === 'done') {
      if (!this.diveP) this.buildDive();
      const u = easeIO(clamp(rt.td / 3.2, 0, 1));
      this.diveP!.getPoint(u, this.tgtPos);
      this.diveL!.getPoint(u, this.tgtLook);
      if (rt.td >= D_FUSE && !rt.frozen) {
        const k = sm(D_FUSE, D_FLASH, rt.td) * 0.08;
        this.tgtPos.x += (Math.random() - 0.5) * k;
        this.tgtPos.y += (Math.random() - 0.5) * k;
      }
    } else {
      const o = this.orb;
      if (rt.autoRot && !rt.dragging) o.th += dt * 0.12;
      o.r += (o.rT - o.r) * Math.min(1, dt * 1.5);
      this.tgtLook.copy(o.c);
      this.tgtPos.set(
        o.c.x + o.r * Math.sin(o.ph) * Math.sin(o.th),
        o.c.y + o.r * Math.cos(o.ph),
        o.c.z + o.r * Math.sin(o.ph) * Math.cos(o.th),
      );
    }

    if (rt.reduced && (mode === 'intro' || mode === 'loading')) {
      // cuts, not flights
      this.camPos.copy(this.tgtPos);
      this.camLook.copy(this.tgtLook);
    } else {
      const k = 1 - Math.exp(-dt * this.springK);
      this.camPos.lerp(this.tgtPos, k);
      this.camLook.lerp(this.tgtLook, Math.min(1, k * 1.2));
      this.springK += (4 - this.springK) * dt * 0.4;
    }
    camera.position.copy(this.camPos);
    camera.lookAt(this.camLook);

    const heroTarget = mode === 'explore' && rt.hero && width > 900 ? -0.17 : 0;
    this.heroOff += (heroTarget - this.heroOff) * Math.min(1, dt * 2.5);
    if (Math.abs(this.heroOff) > 0.001) camera.setViewOffset(width, height, this.heroOff * width, 0, width, height);
    else if (camera.view?.enabled) camera.clearViewOffset();

    const t = rt.t;
    const td = rt.td;
    camera.fov =
      mode === 'intro' || mode === 'loading'
        ? 40 - sm(6.8, 9.2, t) * 4 + sm(9.2, 11, t) * 4
        : mode === 'dive' || mode === 'done'
          ? 40 + sm(0.6, 1.6, td) * 14 + sm(D_FUSE, D_FLASH, td) * 22
          : 40;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();

    const bo = mode === 'intro' || mode === 'loading' ? sm(8.3, 9.6, t) : 1;
    w.beam.uniforms.opacity.value = bo;
    w.beam.ripples.forEach((r, i) => {
      const ph = (w.beam.uniforms.time.value * 0.45 + i / 3) % 1;
      r.scale.setScalar(1 + ph * 9);
      r.material.opacity = (1 - ph) * bo * 0.5;
    });
  }

  /** Screen-space outputs for the DOM overlay: lens flare and hotspots (prototype `updFlare`, `updHots`). */
  project(camera: PerspectiveCamera, satellite: Object3D, width: number, height: number): void {
    const rt = this.rt;
    const sp = this.v3.copy(this.sunW).project(camera);
    let a = 0;
    if (sp.z < 1 && Math.abs(sp.x) < 1.3 && Math.abs(sp.y) < 1.3) {
      this.ray.set(camera.position, SUN_DIR);
      a = this.ray.intersectsSphere(this.earthSphere) ? 0 : clamp(1 - Math.hypot(sp.x, sp.y) / 1.4, 0, 1);
    }
    rt.flareA = a;
    for (let k = 0; k < FLARE.length; k++) {
      const f = FLARE[k]![0];
      rt.flareX[k] = (sp.x * f * 0.5 + 0.5) * width;
      rt.flareY[k] = (-sp.y * f * 0.5 + 0.5) * height;
    }
    if (rt.mode !== 'explore') return;
    satellite.updateMatrixWorld();
    HOTSPOTS.forEach((h, i) => {
      const v = this.v3.set(h.pos[0], h.pos[1], h.pos[2]).applyMatrix4(satellite.matrixWorld).project(camera);
      rt.hotVis[i] = v.z < 1 ? 1 : 0;
      rt.hotX[i] = (v.x * 0.5 + 0.5) * width;
      rt.hotY[i] = (-v.y * 0.5 + 0.5) * height;
    });
  }
}

