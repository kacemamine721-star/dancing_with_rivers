/**
 * Persistent 3D stage (docs/04 §7.1, docs/06 §4). Mounted ONCE by AppShell, outside the route
 * outlet, so the Canvas survives navigation. Loaded lazily: three.js / R3F / postprocessing land in
 * the separate `three` chunk.
 *
 * One Canvas, two worlds: the cinematic intro and the Mellègue terrain. The terrain is mounted
 * (hidden) from the start so its rasters load and compile during the intro; the swap happens under
 * the dive's white flash (`store.stageScene`).
 */
import { useProgress } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ACESFilmicToneMapping, SRGBColorSpace } from 'three';

import { D_FUSE, intro } from '@/features/intro/runtime';
import { Effects } from '@/scene/Effects';
import { IntroScene } from '@/scene/intro/IntroScene';
import { MellegueScene } from '@/scene/mellegue/MellegueScene';
import { hasWebGL2, TIERS } from '@/scene/quality';
import { veil } from '@/scene/veil';
import { useAppStore } from '@/store/app';

/** Advances the intro clock (also after the swap, so the flash can fade) and drives the veils. */
function IntroClock({ host }: { host: React.RefObject<HTMLDivElement> }) {
  useFrame((_, delta) => {
    // the dive is a fixed 3.4 s timeline: a hitch at the swap (under the flash) must not stretch it
    intro.advance(Math.min(delta, intro.mode === 'dive' || intro.mode === 'done' ? 0.25 : 0.05));
    veil.setFlash(intro.flash());
    const fuse = intro.mode === 'dive' && intro.td >= D_FUSE && intro.td < 3.4 && !intro.reduced;
    const el = host.current;
    if (el && el.dataset.fuse !== String(fuse)) {
      // prototype `#gl.fuse`
      el.dataset.fuse = String(fuse);
      el.style.filter = fuse ? 'blur(14px) brightness(2.4) saturate(1.5)' : '';
      el.style.transform = fuse ? 'scale(1.3)' : '';
    }
  });
  return null;
}

/** drei useProgress (three's DefaultLoadingManager) → intro loader readiness. */
function ProgressBridge() {
  const active = useProgress((s) => s.active);
  useEffect(() => intro.setReadiness({ assetsIdle: !active }), [active]);
  return null;
}

/** Static film grain (prototype: 256² random greys, overlay 6 %), in the canvas' stacking context so the blend works. */
function useGrainUrl(enabled: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || url) return;
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      const x = c.getContext('2d');
      if (!x) return;
      const d = x.createImageData(256, 256);
      for (let i = 0; i < d.data.length; i += 4) {
        const v = Math.random() * 255;
        d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
        d.data[i + 3] = 255;
      }
      x.putImageData(d, 0, 0);
      setUrl(c.toDataURL());
    } catch {
      /* no 2D canvas */
    }
  }, [enabled, url]);
  return enabled ? url : null;
}

const veilBase: CSSProperties = { position: 'fixed', inset: 0, pointerEvents: 'none', opacity: 0 };

function Veils() {
  return createPortal(
    <>
      <div
        ref={(el) => {
          veil.flashEl = el;
        }}
        aria-hidden
        style={{
          ...veilBase,
          zIndex: 60,
          background: 'radial-gradient(circle at 50% 55%,#fff,#bff9ff 35%,#0c2a33 100%)',
        }}
      />
      <div
        ref={(el) => {
          veil.fadeEl = el;
        }}
        aria-hidden
        style={{ ...veilBase, zIndex: 59, background: '#000' }}
      />
    </>,
    document.body,
  );
}

export default function Stage({ active = true }: { active?: boolean }) {
  const [webgl2] = useState(hasWebGL2);
  const stageScene = useAppStore((s) => s.stageScene);
  const quality = useAppStore((s) => s.quality);
  const host = useRef<HTMLDivElement>(null);
  const [introUsed, setIntroUsed] = useState(stageScene === 'intro');
  const reduced = useAppStore((s) => s.reducedMotion);
  const grain = useGrainUrl(stageScene === 'intro' && !reduced);

  useEffect(() => {
    if (!webgl2) {
      useAppStore.getState().setQuality('2d');
      intro.setReadiness({ stageReady: true, dataReady: true, terrainReady: true });
    }
  }, [webgl2]);

  useEffect(() => {
    // initial tier: small touch screens start low
    try {
      if (matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 700) {
        useAppStore.getState().setQuality('low');
      }
    } catch {
      /* no matchMedia */
    }
  }, []);

  // the intro world is built the first time it is needed (deep links never pay for it)
  useEffect(() => {
    if (stageScene === 'intro') setIntroUsed(true);
  }, [stageScene]);

  if (!webgl2 || quality === '2d') return null;

  const isIntro = stageScene === 'intro';
  const tier = TIERS[quality];
  const dpr: [number, number] = isIntro ? [1, 2] : [1, tier.dpr];

  return (
    <div
      ref={host}
      className="stage-host"
      style={{
        position: 'absolute',
        inset: 0,
        visibility: active ? 'visible' : 'hidden',
        transition: 'filter .9s ease, transform 1.1s cubic-bezier(.6,0,.9,.4)',
      }}
    >
      <Canvas
        dpr={dpr}
        frameloop={active ? 'always' : 'never'}
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
        camera={{ fov: 40, near: 0.05, far: 4000, position: [8, 7, 82] }}
        onCreated={({ gl }) => {
          gl.outputColorSpace = SRGBColorSpace;
          gl.toneMapping = ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.15; // prototype
          gl.setClearColor('#000000', 1);
        }}
        style={{ touchAction: 'none' }}
      >
        <IntroClock host={host} />
        <ProgressBridge />
        {introUsed ? <IntroScene active={isIntro} /> : null}
        <MellegueScene active={!isIntro} />
        {!isIntro ? <Effects /> : null}
      </Canvas>
      {grain ? (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            opacity: 0.06,
            backgroundImage: `url(${grain})`,
            backgroundSize: '128px 128px',
            mixBlendMode: 'overlay',
          }}
        />
      ) : null}
      <Veils />
    </div>
  );
}
