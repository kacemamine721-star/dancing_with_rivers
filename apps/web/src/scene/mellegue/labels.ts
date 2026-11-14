/**
 * A light DOM label layer over the canvas: plain divs positioned once per frame from scene points
 * (one projection loop for all labels, no React render per frame, unlike one drei <Html> each).
 */
import { type Camera, Vector3 } from 'three';

import type { Vec3 } from '@/scene/coords';
import { tokens } from '@/styles/tokens';

export type LabelKind = 'reach' | 'tick' | 'town' | 'village';

export type LabelSpec = { id: string; text: string; sub?: string; pos: Vec3; kind: LabelKind };

const STYLE: Record<LabelKind, Partial<CSSStyleDeclaration>> = {
  reach: {
    fontSize: '11px',
    letterSpacing: '.12em',
    color: tokens.color.ink,
    background: 'rgba(3,5,10,.72)',
    border: `1px solid ${tokens.color.tealDim}`,
    borderRadius: '6px',
    padding: '4px 8px',
  },
  tick: { fontSize: '10px', letterSpacing: '.08em', color: tokens.color.teal, textShadow: '0 0 4px #000, 0 0 2px #000' },
  town: {
    fontSize: '11px',
    letterSpacing: '.1em',
    color: tokens.color.ink,
    textShadow: '0 0 4px #000, 0 0 2px #000, 0 1px 1px #000',
  },
  village: { fontSize: '10px', letterSpacing: '.08em', color: tokens.color.mute, textShadow: '0 0 4px #000, 0 0 2px #000' },
};

type Entry = { spec: LabelSpec; el: HTMLDivElement; opacity: number; shown: string };

const v = new Vector3();

export class LabelLayer {
  readonly root: HTMLDivElement;
  private entries: Entry[] = [];

  constructor(parent: HTMLElement) {
    const r = document.createElement('div');
    r.setAttribute('aria-hidden', 'true');
    Object.assign(r.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden', zIndex: '4' });
    parent.appendChild(r);
    this.root = r;
  }

  set(specs: readonly LabelSpec[]): void {
    this.clear();
    for (const spec of specs) {
      const el = document.createElement('div');
      Object.assign(el.style, {
        position: 'absolute',
        left: '0',
        top: '0',
        fontFamily: tokens.font.mono,
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        opacity: '0',
        willChange: 'transform, opacity',
        transition: 'opacity .35s ease',
        ...STYLE[spec.kind],
      });
      el.textContent = spec.text;
      if (spec.sub) {
        const s = document.createElement('span');
        s.textContent = ` · ${spec.sub}`;
        s.style.color = tokens.color.mute;
        el.appendChild(s);
      }
      this.root.appendChild(el);
      this.entries.push({ spec, el, opacity: -1, shown: '' });
    }
  }

  /**
   * Position every label. `alpha(spec)` returns its target opacity (0 hides it); labels behind the
   * camera or beyond `maxKm` are hidden.
   */
  update(camera: Camera, width: number, height: number, alpha: (spec: LabelSpec) => number, maxKm = 140): void {
    for (const e of this.entries) {
      const p = e.spec.pos;
      v.set(p[0], p[1], p[2]);
      const d = v.distanceTo(camera.position);
      v.project(camera);
      let a = alpha(e.spec);
      if (v.z > 1 || v.z < -1 || d > maxKm) a = 0;
      const op = a <= 0.01 ? 0 : a;
      if (op !== e.opacity) {
        e.el.style.opacity = op.toFixed(2);
        e.opacity = op;
      }
      if (op === 0) continue;
      const x = Math.round((v.x * 0.5 + 0.5) * width);
      const y = Math.round((-v.y * 0.5 + 0.5) * height);
      const lift = e.spec.kind === 'reach' ? 16 : 10;
      const t = `translate(-50%, -100%) translate(${x}px, ${y - lift}px)`;
      if (t !== e.shown) {
        e.el.style.transform = t;
        e.shown = t;
      }
    }
  }

  clear(): void {
    for (const e of this.entries) e.el.remove();
    this.entries = [];
  }

  dispose(): void {
    this.clear();
    this.root.remove();
  }
}
