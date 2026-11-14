import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import type { PerspectiveCamera } from 'three';

import { intro, T_HERO } from '@/features/intro/runtime';
import { IntroDirector } from '@/scene/intro/director';
import { createIntroWorld } from '@/scene/intro/world';
import { veil } from '@/scene/veil';

const SIM_DT = 1 / 60;

/**
 * Replay the intro history at a fixed 60 Hz up to the debug-seek time, then freeze
 * (`/?t=` intro, `/?dive=` dive after 0.5 s of hero orbit). Deterministic, so the frame
 * matches the reference prototype captured the same way.
 */
function simulateSeek(director: IntroDirector, camera: PerspectiveCamera, w: number, h: number): void {
  const seek = intro.seek;
  if (!seek) return;
  intro.frozen = false;
  const terrain = intro.terrainReady;
  let elapsed = 0;
  const target = seek.kind === 'intro' ? seek.time : T_HERO + 0.5;
  director.step(0, camera, w, h);
  while (elapsed + 1e-9 < target) {
    intro.advance(SIM_DT);
    director.step(SIM_DT, camera, w, h);
    elapsed += SIM_DT;
  }
  if (seek.kind === 'dive') {
    intro.startMission();
    director.step(0, camera, w, h);
    while (intro.td + 1e-9 < seek.time) {
      intro.advance(SIM_DT);
      director.step(SIM_DT, camera, w, h);
    }
  }
  intro.terrainReady = terrain;
  intro.frozen = true;
  intro.emit('mode');
}

/**
 * Scene 1 of the persistent Canvas: the cinematic intro. The imperative world is built once
 * (first time the intro is shown) and driven from useFrame; the DOM overlay reads the runtime.
 */
export function IntroScene({ active }: { active: boolean }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const world = useMemo(() => createIntroWorld(gl), [gl]);
  const director = useMemo(() => new IntroDirector(world, intro), [world]);
  const seekedEpoch = useRef(-1);

  useEffect(() => () => world.dispose(), [world]);

  // environment + camera range while the intro is on screen
  useEffect(() => {
    if (!active) return;
    scene.environment = world.environment;
    camera.near = 0.05;
    camera.far = 4000;
    camera.fov = 40;
    camera.updateProjectionMatrix();
    return () => {
      if (scene.environment === world.environment) scene.environment = null;
      camera.clearViewOffset();
    };
  }, [active, camera, scene, world]);

  // compile once, then tell the loader the stage is ready
  useEffect(() => {
    director.reset();
    director.step(0, camera, size.width, size.height);
    gl.compile(scene, camera);
    intro.setReadiness({ stageReady: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per world
  }, [director]);

  // explore: drag to orbit, wheel to zoom (prototype listeners on the canvas)
  useEffect(() => {
    const el = gl.domElement;
    let lx = 0;
    let ly = 0;
    const down = (e: PointerEvent) => {
      if (intro.mode !== 'explore') return;
      intro.pauseAuto();
      intro.dragging = true;
      lx = e.clientX;
      ly = e.clientY;
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!intro.dragging) return;
      director.drag(e.clientX - lx, e.clientY - ly);
      lx = e.clientX;
      ly = e.clientY;
    };
    const up = () => {
      intro.dragging = false;
    };
    const wheel = (e: WheelEvent) => {
      if (intro.mode !== 'explore') return;
      e.preventDefault();
      intro.pauseAuto();
      director.zoom(e.deltaY);
    };
    const pointer = (e: PointerEvent) => {
      intro.mx = e.clientX / window.innerWidth - 0.5;
      intro.my = e.clientY / window.innerHeight - 0.5;
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('pointermove', pointer);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
      window.removeEventListener('pointermove', pointer);
    };
  }, [director, gl]);

  useFrame((_, delta) => {
    if (!active) return;
    const dt = intro.frozen ? 0 : Math.min(delta, 0.05);
    const { width, height } = size;
    if (intro.seek && intro.frozen && intro.mode !== 'loading' && seekedEpoch.current !== intro.epoch) {
      seekedEpoch.current = intro.epoch;
      simulateSeek(director, camera, width, height);
    }
    const before = director.chapter;
    director.step(dt, camera, width, height);
    if (intro.reduced && intro.mode === 'intro') {
      // reduced motion: crossfade at each chapter cut
      const k = Math.max(0, [0, 3.4, 6.8, 9.2, 11].filter((s) => intro.t >= s).length - 1);
      if (k !== before) {
        if (before >= 0) veil.cut(() => undefined);
        director.chapter = k;
      }
    }
    director.project(camera, world.nisar.group, width, height);
    intro.emit('frame');
  });

  return <primitive object={world.root} visible={active} />;
}
