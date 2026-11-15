import { useProgress } from '@react-three/drei';
import { useEffect, useRef, useState } from 'react';

import { useSceneStatus } from '@/scene/status';
import { useAppStore } from '@/store/app';
import { tokens } from '@/styles/tokens';

const FADE_MS = 700;

/**
 * Loading veil over the Mellègue stage (deep links, slow networks): the canvas is never a blank
 * black rectangle. Telemetry look of the prototype: a radar sweep, a tracked mono label and a thin
 * progress bar fed by three's loading manager. It sits under the story card (z-order of the stage),
 * so the reader can start reading while the terrain arrives.
 */
export function LoadingVeil({ active }: { active: boolean }) {
  const stageScene = useAppStore((s) => s.stageScene);
  const reduced = useAppStore((s) => s.reducedMotion);
  const ready = useSceneStatus((s) => s.terrainReady || s.terrainError);
  const error = useSceneStatus((s) => s.terrainError);
  const progress = useProgress((s) => s.progress);
  const shown = active && stageScene === 'mellegue' && !ready;
  const [mounted, setMounted] = useState(shown);
  const peak = useRef(0);

  useEffect(() => {
    if (shown) {
      setMounted(true);
      return;
    }
    const id = setTimeout(() => setMounted(false), FADE_MS);
    return () => clearTimeout(id);
  }, [shown]);

  if (!mounted) return null;
  // monotonic, and never "100 %" before the program is compiled
  peak.current = Math.max(peak.current, Math.min(96, progress));
  const pct = ready ? 100 : Math.round(peak.current);

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 3,
        display: 'grid',
        placeItems: 'center',
        pointerEvents: 'none',
        background: `radial-gradient(ellipse at 62% 55%, #0b1a26 0%, ${tokens.color.bg} 70%)`,
        opacity: shown ? 1 : 0,
        transition: `opacity ${FADE_MS}ms ease`,
      }}
    >
      <style>{`@keyframes dwd-sweep{to{transform:rotate(360deg)}}@keyframes dwd-blink{50%{opacity:.35}}`}</style>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 18,
          // centre of the free area on desktop (right of the story card)
          transform: 'translateX(clamp(0px, calc((100vw - 1024px) * 99), 256px))',
        }}
      >
        <div
          aria-hidden
          style={{
            position: 'relative',
            width: 92,
            height: 92,
            borderRadius: '50%',
            border: `1px solid ${tokens.color.tealDim}`,
            boxShadow: `inset 0 0 0 22px rgba(3,5,10,.0), inset 0 0 0 23px ${tokens.color.tealDim}`,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: '50%',
              background: `conic-gradient(from 0deg, rgba(95,243,255,0) 0deg, rgba(95,243,255,0) 290deg, rgba(95,243,255,.55) 360deg)`,
              animation: reduced ? 'none' : 'dwd-sweep 2.4s linear infinite',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: 6,
              height: 6,
              margin: -3,
              borderRadius: '50%',
              background: tokens.color.teal,
              boxShadow: `0 0 12px ${tokens.color.teal}`,
            }}
          />
        </div>
        <div
          style={{
            fontFamily: tokens.font.mono,
            fontSize: 11,
            letterSpacing: '.22em',
            textTransform: 'uppercase',
            color: tokens.color.teal,
            animation: reduced ? 'none' : 'dwd-blink 1.6s ease-in-out infinite',
          }}
        >
          {error ? 'Terrain unavailable' : 'Loading terrain and radar'}
        </div>
        <div style={{ width: 220, height: 2, background: tokens.color.hairline, borderRadius: 2, overflow: 'hidden' }}>
          <div
            style={{
              width: `${pct}%`,
              height: '100%',
              background: tokens.color.teal,
              boxShadow: `0 0 8px ${tokens.color.teal}`,
              transition: 'width .3s ease',
            }}
          />
        </div>
        <div
          style={{
            fontFamily: tokens.font.mono,
            fontSize: 10,
            letterSpacing: '.16em',
            textTransform: 'uppercase',
            color: tokens.color.mute,
          }}
        >
          {pct} %
        </div>
      </div>
    </div>
  );
}
