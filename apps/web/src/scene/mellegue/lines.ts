/**
 * Screen-space wide lines draped on the terrain (flow path, dam crest): constant pixel width at any
 * distance, soft anti-aliased edges, optional flowing dashes and a draw-on front. One quad strip per
 * polyline, expanded in the vertex shader (WebGL lines are 1 px wide).
 */
import { BufferGeometry, Color, Float32BufferAttribute, Mesh, NormalBlending, ShaderMaterial, Uint32BufferAttribute, Vector2 } from 'three';

import type { Vec3 } from '@/scene/coords';

const vertexShader = /* glsl */ `
attribute vec3 aPrev;
attribute vec3 aNext;
attribute float aSide;
attribute float aDist;
uniform vec2 uResolution;
uniform float uWidth;  // drawing-buffer pixels
uniform float uLift;   // fraction of the view distance pulled toward the camera (depth bias)
varying float vDist;
varying float vSide;

vec4 clipOf(vec3 p) {
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  mv.xyz *= 1.0 - uLift;
  return projectionMatrix * mv;
}

void main() {
  vec4 c = clipOf(position);
  vec4 cp = clipOf(aPrev);
  vec4 cn = clipOf(aNext);
  vec2 half_ = 0.5 * uResolution;
  vec2 s = c.xy / max(c.w, 1e-4) * half_;
  vec2 sp = cp.xy / max(cp.w, 1e-4) * half_;
  vec2 sn = cn.xy / max(cn.w, 1e-4) * half_;
  vec2 d1 = s - sp;
  vec2 d2 = sn - s;
  vec2 dir = vec2(0.0);
  if (dot(d1, d1) > 1e-8) dir += normalize(d1);
  if (dot(d2, d2) > 1e-8) dir += normalize(d2);
  dir = dot(dir, dir) > 1e-8 ? normalize(dir) : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  c.xy += nrm * aSide * (uWidth * 0.5) / half_ * c.w;
  vDist = aDist;
  vSide = aSide;
  gl_Position = c;
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uTime;
uniform float uDraw;   // 0..1 fraction of the length drawn (draw-on)
uniform float uLen;    // total length (km)
uniform float uDash;   // dash period (km); 0 = solid
uniform float uSpeed;  // dash / pulse speed (km/s), downstream
uniform float uGlow;   // brightness of the draw-on head and pulses (> 1 feeds the bloom)
uniform float uPulse;  // pulse period (km); 0 = no travelling pulses
uniform float uCore;   // half-width of the solid core, fraction of the strip (1 = no halo)
uniform float uHalo;   // strength of the soft halo around the core
varying float vDist;
varying float vSide;

void main() {
  float s = vDist / max(uLen, 1e-6);
  if (s > uDraw) discard;
  float a = abs(vSide);
  float core = 1.0 - smoothstep(max(uCore - 0.18, 0.0), uCore, a);
  float halo = (1.0 - a) * (1.0 - a) * uHalo;
  float k = 1.0;
  if (uDash > 0.0) {
    float ph = fract((vDist - uTime * uSpeed) / uDash);
    k = 0.42 + 0.58 * smoothstep(0.0, 0.12, ph) * (1.0 - smoothstep(0.5, 0.62, ph));
  }
  float pulse = 0.0;
  if (uPulse > 0.0) {
    // sawtooth: a bright leading head with a fading tail, moving downstream
    float ph = fract((vDist - uTime * uSpeed) / uPulse);
    pulse = pow(smoothstep(0.0, 0.9, ph), 3.0) * (1.0 - smoothstep(0.9, 0.97, ph));
  }
  float head = uDraw < 0.999 ? smoothstep(uDraw - 0.015, uDraw, s) : 0.0;
  vec3 col = uColor * (k + head * uGlow + pulse * uGlow);
  float alpha = max(core * max(k, head), halo * (0.55 + 0.45 * pulse));
  gl_FragColor = vec4(col, uOpacity * alpha);
  #include <colorspace_fragment>
}
`;

export type LineStyle = {
  color: string;
  widthPx: number;
  opacity?: number;
  dashKm?: number;
  speedKmS?: number;
  glow?: number;
  lift?: number;
  /** Travelling pulse period (km); pulses move at `speedKmS`. */
  pulseKm?: number;
  /** Solid core half-width as a fraction of the strip (default 1 = no halo). */
  core?: number;
  halo?: number;
};

export function lineMaterial(style: LineStyle): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
    uniforms: {
      uResolution: { value: new Vector2(1, 1) },
      uWidth: { value: style.widthPx },
      uLift: { value: style.lift ?? 0.0025 },
      uColor: { value: new Color(style.color) },
      uOpacity: { value: style.opacity ?? 1 },
      uTime: { value: 0 },
      uDraw: { value: 1 },
      uLen: { value: 1 },
      uDash: { value: style.dashKm ?? 0 },
      uSpeed: { value: style.speedKmS ?? 0 },
      uGlow: { value: style.glow ?? 0 },
      uPulse: { value: style.pulseKm ?? 0 },
      uCore: { value: style.core ?? 1 },
      uHalo: { value: style.halo ?? 0 },
    },
  });
}

/** Quad-strip geometry for a polyline of scene points; `aDist` = cumulative 3D-free (x/z) length in km. */
export function lineGeometry(points: readonly Vec3[]): { geometry: BufferGeometry; length: number } {
  const n = points.length;
  const pos = new Float32Array(n * 6);
  const prev = new Float32Array(n * 6);
  const next = new Float32Array(n * 6);
  const side = new Float32Array(n * 2);
  const dist = new Float32Array(n * 2);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const p = points[i]!;
    const a = points[Math.max(0, i - 1)]!;
    const b = points[Math.min(n - 1, i + 1)]!;
    if (i > 0) acc += Math.hypot(p[0] - a[0], p[2] - a[2]);
    for (let k = 0; k < 2; k++) {
      const j = (i * 2 + k) * 3;
      pos.set(p, j);
      prev.set(a, j);
      next.set(b, j);
      side[i * 2 + k] = k === 0 ? -1 : 1;
      dist[i * 2 + k] = acc;
    }
  }
  const idx = new Uint32Array(Math.max(0, n - 1) * 6);
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('aPrev', new Float32BufferAttribute(prev, 3));
  g.setAttribute('aNext', new Float32BufferAttribute(next, 3));
  g.setAttribute('aSide', new Float32BufferAttribute(side, 1));
  g.setAttribute('aDist', new Float32BufferAttribute(dist, 1));
  g.setIndex(new Uint32BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return { geometry: g, length: acc };
}

export function lineMesh(points: readonly Vec3[], material: ShaderMaterial): Mesh {
  const { geometry, length } = lineGeometry(points);
  material.uniforms.uLen!.value = length;
  const m = new Mesh(geometry, material);
  m.frustumCulled = false;
  m.renderOrder = 6;
  return m;
}

/**
 * Resample a polyline (scene x/z in km) every `stepKm`, placing each point on the rendered terrain
 * surface. Returns the points and the along-path distance of each.
 */
export function drape(
  xz: readonly (readonly [number, number])[],
  stepKm: number,
  surface: (x: number, z: number) => number,
  liftKm = 0.004,
): { points: Vec3[]; dist: number[] } {
  const points: Vec3[] = [];
  const dist: number[] = [];
  let acc = 0;
  for (let i = 0; i < xz.length; i++) {
    const [x1, z1] = xz[i]!;
    if (i === 0) {
      points.push([x1, surface(x1, z1) + liftKm, z1]);
      dist.push(0);
      continue;
    }
    const [x0, z0] = xz[i - 1]!;
    const seg = Math.hypot(x1 - x0, z1 - z0);
    const steps = Math.max(1, Math.ceil(seg / stepKm));
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const x = x0 + (x1 - x0) * t;
      const z = z0 + (z1 - z0) * t;
      points.push([x, surface(x, z) + liftKm, z]);
      dist.push(acc + seg * t);
    }
    acc += seg;
  }
  return { points, dist };
}
