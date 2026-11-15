/**
 * A light DOM label layer over the canvas: plain divs positioned once per frame from scene points
 * (one projection loop for all labels, no React render per frame, unlike one drei <Html> each).
 * Optional greedy declutter: labels are placed in the order given (= priority) and a label whose
 * box overlaps one already placed is hidden.
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
    background: 'rgba(3,5,10,.74)',
    border: `1px solid rgba(95, 243, 255, 0.35)`,
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
  village: { fontSize: '10px', letterSpacing: '.08em', color: '#c9d3e3', textShadow: '0 0 4px #000, 0 0 2px #000' },
};

type Entry = {
  spec: LabelSpec;
  el: HTMLDivElement;
  dot: HTMLSpanElement | null;
  opacity: number;
  shown: string;
  w: number;
  h: number;
};

const v = new Vector3();

export class LabelLayer {
  readonly root: HTMLDivElement;
  private entries: Entry[] = [];
  private byId = new Map<string, Entry>();

  constructor(parent: HTMLElement) {
    const r = document.createElement('div');
    r.setAttribute('aria-hidden', 'true');
    Object.assign(r.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden', zIndex: '2' });
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
        display: 'flex',
        alignItems: 'center',
        gap: '5px',
        ...STYLE[spec.kind],
      });
      let dot: HTMLSpanElement | null = null;
      if (spec.kind === 'village' || spec.kind === 'town') {
        dot = document.createElement('span');
        Object.assign(dot.style, {
          display: 'inline-block',
          width: spec.kind === 'town' ? '6px' : '5px',
          height: spec.kind === 'town' ? '6px' : '5px',
          borderRadius: '50%',
          background: tokens.color.ink,
          boxShadow: '0 0 0 1px rgba(0,0,0,.6)',
          flex: 'none',
        });
        el.appendChild(dot);
      }
      el.appendChild(document.createTextNode(spec.text));
      if (spec.sub) {
        const s = document.createElement('span');
        s.textContent = `· ${spec.sub}`;
        s.style.color = tokens.color.mute;
        el.appendChild(s);
      }
      this.root.appendChild(el);
      const e: Entry = { spec, el, dot, opacity: -1, shown: '', w: 0, h: 0 };
      this.entries.push(e);
      this.byId.set(spec.id, e);
    }
  }

  /** Colour of a label's dot (e.g. "reached by the water"); null = default. */
  tone(id: string, color: string | null): void {
    const e = this.byId.get(id);
    if (!e?.dot) return;
    const c = color ?? tokens.color.ink;
    if (e.dot.style.background !== c) {
      e.dot.style.background = c;
      e.dot.style.boxShadow = color ? `0 0 6px ${color}, 0 0 0 1px rgba(0,0,0,.6)` : '0 0 0 1px rgba(0,0,0,.6)';
    }
  }

  /**
   * Position every label. `alpha(spec)` returns its target opacity (0 hides it); labels behind the
   * camera or beyond `maxKm` are hidden. With `declutter`, overlapping lower-priority labels hide.
   */
  update(
    camera: Camera,
    width: number,
    height: number,
    alpha: (spec: LabelSpec) => number,
    maxKm = 140,
    declutter = false,
  ): void {
    const placed: [number, number, number, number][] = [];
    for (const e of this.entries) {
      const p = e.spec.pos;
      v.set(p[0], p[1], p[2]);
      const d = v.distanceTo(camera.position);
      v.project(camera);
      let a = alpha(e.spec);
      if (v.z > 1 || v.z < -1 || d > maxKm) a = 0;
      const x = Math.round((v.x * 0.5 + 0.5) * width);
      const lift = e.spec.kind === 'reach' ? 16 : 6;
      const y = Math.round((-v.y * 0.5 + 0.5) * height) - lift;
      if (a > 0.01 && (x < -40 || x > width + 40 || y < -20 || y > height + 40)) a = 0;
      if (a > 0.01 && declutter) {
        if (e.w === 0) {
          e.w = e.el.offsetWidth || e.spec.text.length * 7 + 16;
          e.h = e.el.offsetHeight || 16;
        }
        const box: [number, number, number, number] = [x - e.w / 2 - 4, y - e.h - 2, x + e.w / 2 + 4, y + 2];
        if (placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) a = 0;
        else placed.push(box);
      }
      const op = a <= 0.01 ? 0 : Math.min(1, a);
      if (op !== e.opacity) {
        e.el.style.opacity = op.toFixed(2);
        e.opacity = op;
      }
      if (op === 0) continue;
      const t = `translate(-50%, -100%) translate(${x}px, ${y}px)`;
      if (t !== e.shown) {
        e.el.style.transform = t;
        e.shown = t;
      }
    }
  }

  clear(): void {
    for (const e of this.entries) e.el.remove();
    this.entries = [];
    this.byId.clear();
  }

  dispose(): void {
    this.clear();
    this.root.remove();
  }
}
