import { CameraControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import gsap from 'gsap';
import { type ComponentRef, useEffect, useRef } from 'react';
import { Box3, CatmullRomCurve3, type PerspectiveCamera, Vector3 } from 'three';

import type { SceneFrame, Vec3 } from '@/scene/coords';
import { focusPoint, NARROW_PX, readOccluders } from '@/scene/framing';
import { sceneVectors } from '@/scene/mellegue/sceneVectors';
import { ACT_SHOTS, resolveShot, type Shot } from '@/scene/shots';
import { veil } from '@/scene/veil';
import { type ShotId, useAppStore } from '@/store/app';

type Controls = ComponentRef<typeof CameraControls>;
type CamState = { px: number; py: number; pz: number; tx: number; ty: number; tz: number; fov: number };

const NEAR = 0.1;
const FAR = 900;
/** Keep the eye this far above the ground (km). */
const CLEARANCE = 0.25;
/** Valley flight: how far along the path (km) the flight goes before rising to the corridor shot. */
const VALLEY_KM = 68;
const VALLEY_S = 11;

const toState = (shot: Shot): CamState => ({
  px: shot.position[0],
  py: shot.position[1],
  pz: shot.position[2],
  tx: shot.target[0],
  ty: shot.target[1],
  tz: shot.target[2],
  fov: shot.fov,
});

/** Smoothed spline along the valley floor (ground samples every 2 km, dam first). */
function valleyCurve(ground: readonly Vec3[]): CatmullRomCurve3 | null {
  const n = Math.min(ground.length, Math.floor(VALLEY_KM / 2) + 1);
  if (n < 4) return null;
  let pts = ground.slice(0, n).map((p) => new Vector3(p[0], p[1], p[2]));
  for (let pass = 0; pass < 3; pass++) {
    pts = pts.map((p, i) => {
      if (i === 0 || i === pts.length - 1) return p.clone();
      return new Vector3().addVectors(pts[i - 1]!, pts[i + 1]!).addScaledVector(p, 2).multiplyScalar(0.25);
    });
  }
  return new CatmullRomCurve3(pts, false, 'centripetal');
}

/** Camera behind and above the valley at `u`, looking down-valley. */
function valleyState(curve: CatmullRomCurve3, frame: SceneFrame, u: number, fov: number): CamState {
  const p = curve.getPointAt(u);
  const t = curve.getTangentAt(u);
  t.y = 0;
  t.normalize();
  const ahead = curve.getPointAt(Math.min(1, u + 0.07));
  const cx = p.x - t.x * 5.5 + t.z * 1.2;
  const cz = p.z - t.z * 5.5 - t.x * 1.2;
  const ground = frame.sampleHeight(cx, cz);
  return { px: cx, py: Math.max(ground, p.y) + 3.4, pz: cz, tx: ahead.x, ty: ahead.y, tz: ahead.z, fov };
}

/**
 * Camera for the Mellègue stage: drei CameraControls for free orbit (damped, clamped) and GSAP
 * flights between the typed shots when `act` or `shot` changes; `valley_follow` flies along the
 * flow path. A lens shift keeps the subject in the free part of the screen (framing.ts). Reduced
 * motion → cuts with a 300 ms crossfade. A user grab cancels the flight in progress.
 */
export function CameraRig({ frame }: { frame: SceneFrame }) {
  const controlsRef = useRef<Controls>(null);
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const tween = useRef<gsap.core.Timeline | null>(null);
  const bias = useRef({ x: 0, y: 0 });
  /** valley_follow requested before the flow path loaded: fly once it arrives. */
  const pendingValley = useRef(false);
  const runRef = useRef<((ids: readonly ShotId[], cutFirst: boolean) => void) | null>(null);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    camera.near = NEAR;
    camera.far = FAR;
    camera.clearViewOffset();
    camera.updateProjectionMatrix();

    const half = new Vector3(frame.width / 2, 0, frame.depth / 2);
    controls.setBoundary(new Box3(new Vector3(-half.x, -1, -half.z), new Vector3(half.x, 8, half.z)));

    const apply = (s: CamState) => {
      void controls.setLookAt(s.px, s.py, s.pz, s.tx, s.ty, s.tz, false);
      if (camera.fov !== s.fov) {
        camera.fov = s.fov;
        camera.updateProjectionMatrix();
      }
    };
    const current = (): CamState => {
      const p = controls.getPosition(new Vector3());
      const t = controls.getTarget(new Vector3());
      return { px: p.x, py: p.y, pz: p.z, tx: t.x, ty: t.y, tz: t.z, fov: camera.fov };
    };

    /** Go through `ids`: cut to the first when `cutFirst`, fly through the rest. */
    const run = (ids: readonly ShotId[], cutFirst: boolean) => {
      tween.current?.kill();
      tween.current = null;
      pendingValley.current = false;
      const shots = ids.map((id) => resolveShot(id, frame));
      const reduced = useAppStore.getState().reducedMotion;
      const last = shots[shots.length - 1];
      if (last) bias.current = last.bias;
      if (reduced) {
        if (last) veil.cut(() => apply(toState(last)));
        return;
      }

      // valley_follow: fly along the flow path, then rise to the whole corridor
      if (ids.length === 1 && ids[0] === 'valley_follow') {
        const curve = sceneVectors.valley ? valleyCurve(sceneVectors.valley) : null;
        if (!curve) pendingValley.current = true;
        else {
          const end = toState(shots[0]!);
          const start = valleyState(curve, frame, 0, 42);
          const proxy = cutFirst ? { ...start } : current();
          if (cutFirst) apply(start);
          const path = { u: 0 };
          const tl = gsap.timeline({ onUpdate: () => apply(proxy), delay: cutFirst ? 0.6 : 0 });
          if (!cutFirst) tl.to(proxy, { ...start, duration: 1.8, ease: 'power2.inOut' });
          tl.to(path, {
            u: 1,
            duration: VALLEY_S,
            ease: 'sine.inOut',
            onUpdate: () => Object.assign(proxy, valleyState(curve, frame, path.u, 42)),
          });
          tl.to(proxy, { ...end, duration: 3.4, ease: 'power2.inOut' });
          tween.current = tl;
          return;
        }
      }

      let rest = shots;
      if (cutFirst && shots[0]) {
        apply(toState(shots[0]));
        rest = shots.slice(1);
      }
      if (rest.length === 0) return;
      const proxy = current();
      const tl = gsap.timeline({ onUpdate: () => apply(proxy), delay: cutFirst ? 1.4 : 0 });
      for (const shot of rest) {
        tl.to(proxy, { ...toState(shot), duration: shot.durationMs / 1000, ease: shot.ease });
      }
      tween.current = tl;
    };
    runRef.current = run;

    // arrival: cut to the act's first shot (under the flash / on a deep link), then ease on
    const s0 = useAppStore.getState();
    run(s0.shot && s0.shot !== ACT_SHOTS[s0.act][0] ? [s0.shot] : ACT_SHOTS[s0.act], true);

    const unsub = useAppStore.subscribe((s, prev) => {
      if (s.act !== prev.act) run(ACT_SHOTS[s.act], false);
      else if (s.shotSeq !== prev.shotSeq && s.shot) run([s.shot], false);
    });
    const onGrab = () => {
      tween.current?.kill();
      tween.current = null;
      pendingValley.current = false;
    };
    controls.addEventListener('controlstart', onGrab);
    return () => {
      unsub();
      controls.removeEventListener('controlstart', onGrab);
      tween.current?.kill();
      tween.current = null;
      runRef.current = null;
      camera.clearViewOffset();
      camera.updateProjectionMatrix();
    };
  }, [camera, frame]);

  // lens shift towards the free screen area, measured from the DOM a few times a second
  const shift = useRef({ x: 0, y: 0, tx: 0, ty: 0, next: 0, w: 0, h: 0, applied: '' });
  useFrame((state, dt) => {
    const p = camera.position;
    // never under the terrain (runs after CameraControls' own update)
    const ground = frame.sampleHeight(p.x, p.z) + CLEARANCE;
    if (p.y < ground) p.y = ground;

    if (pendingValley.current && sceneVectors.valley) runRef.current?.(['valley_follow'], false);

    const { width: w, height: h } = state.size;
    const sh = shift.current;
    const t = state.clock.elapsedTime;
    if (t >= sh.next || w !== sh.w || h !== sh.h) {
      sh.next = t + 0.4;
      const f = focusPoint(w, h, readOccluders(), bias.current);
      sh.tx = w < NARROW_PX ? 0 : Math.max(-0.3 * w, Math.min(0.3 * w, f.x - w / 2));
      sh.ty = Math.max(-0.3 * h, Math.min(0.3 * h, f.y - h / 2));
      if (w !== sh.w || h !== sh.h) sh.applied = '';
      sh.w = w;
      sh.h = h;
    }
    const k = useAppStore.getState().reducedMotion ? 1 : 1 - Math.exp(-dt * 3);
    sh.x += (sh.tx - sh.x) * k;
    sh.y += (sh.ty - sh.y) * k;
    const key = `${Math.round(sh.x * 4)}:${Math.round(sh.y * 4)}:${w}:${h}`;
    if (key !== sh.applied) {
      sh.applied = key;
      if (Math.abs(sh.x) < 0.5 && Math.abs(sh.y) < 0.5) camera.clearViewOffset();
      else camera.setViewOffset(w, h, -sh.x, -sh.y, w, h);
      camera.updateProjectionMatrix();
    }
  });

  return (
    <CameraControls
      ref={controlsRef}
      makeDefault
      minDistance={0.6}
      maxDistance={150}
      minPolarAngle={0}
      maxPolarAngle={1.38}
      smoothTime={0.25}
      draggingSmoothTime={0.12}
      dollySpeed={0.6}
      truckSpeed={1.4}
    />
  );
}
