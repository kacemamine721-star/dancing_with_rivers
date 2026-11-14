import { CameraControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import gsap from 'gsap';
import { type ComponentRef, useEffect, useRef } from 'react';
import { Box3, type PerspectiveCamera, Vector3 } from 'three';

import type { SceneFrame } from '@/scene/coords';
import { ACT_SHOTS, resolveShot, type Shot } from '@/scene/shots';
import { veil } from '@/scene/veil';
import { type ShotId, useAppStore } from '@/store/app';

type Controls = ComponentRef<typeof CameraControls>;

const NEAR = 0.1;
const FAR = 900;
/** Keep the eye this far above the ground (km). */
const CLEARANCE = 0.25;

/**
 * Camera for the Mellègue stage: drei CameraControls for free orbit (damped, clamped) and GSAP
 * flights between the typed shots when `act` or `shot` changes. Reduced motion → cuts with a
 * 300 ms crossfade. A user grab cancels the flight in progress.
 */
export function CameraRig({ frame }: { frame: SceneFrame }) {
  const controlsRef = useRef<Controls>(null);
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const tween = useRef<gsap.core.Timeline | null>(null);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    camera.near = NEAR;
    camera.far = FAR;
    camera.clearViewOffset();
    camera.updateProjectionMatrix();

    const half = new Vector3(frame.width / 2, 0, frame.depth / 2);
    controls.setBoundary(new Box3(new Vector3(-half.x, -1, -half.z), new Vector3(half.x, 6, half.z)));

    const apply = (s: { px: number; py: number; pz: number; tx: number; ty: number; tz: number; fov: number }) => {
      void controls.setLookAt(s.px, s.py, s.pz, s.tx, s.ty, s.tz, false);
      if (camera.fov !== s.fov) {
        camera.fov = s.fov;
        camera.updateProjectionMatrix();
      }
    };
    const toState = (shot: Shot) => ({
      px: shot.position[0],
      py: shot.position[1],
      pz: shot.position[2],
      tx: shot.target[0],
      ty: shot.target[1],
      tz: shot.target[2],
      fov: shot.fov,
    });
    const current = () => {
      const p = controls.getPosition(new Vector3());
      const t = controls.getTarget(new Vector3());
      return { px: p.x, py: p.y, pz: p.z, tx: t.x, ty: t.y, tz: t.z, fov: camera.fov };
    };

    /** Go through `ids`: cut to the first when `cutFirst`, fly through the rest. */
    const run = (ids: readonly ShotId[], cutFirst: boolean) => {
      tween.current?.kill();
      tween.current = null;
      const shots = ids.map((id) => resolveShot(id, frame));
      const reduced = useAppStore.getState().reducedMotion;
      if (reduced) {
        const last = shots[shots.length - 1];
        if (last) veil.cut(() => apply(toState(last)));
        return;
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

    // arrival: cut to the act's first shot (under the flash / on a deep link), then ease on
    run(ACT_SHOTS[useAppStore.getState().act], true);

    const unsub = useAppStore.subscribe((s, prev) => {
      if (s.act !== prev.act) run(ACT_SHOTS[s.act], false);
      else if (s.shotSeq !== prev.shotSeq && s.shot) run([s.shot], false);
    });
    const onGrab = () => {
      tween.current?.kill();
      tween.current = null;
    };
    controls.addEventListener('controlstart', onGrab);
    return () => {
      unsub();
      controls.removeEventListener('controlstart', onGrab);
      tween.current?.kill();
      tween.current = null;
    };
  }, [camera, frame]);

  // never under the terrain (runs after CameraControls' own update)
  useFrame(() => {
    const p = camera.position;
    const ground = frame.sampleHeight(p.x, p.z) + CLEARANCE;
    if (p.y < ground) p.y = ground;
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
