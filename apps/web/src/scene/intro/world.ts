/**
 * The intro world, ported from reference/NISAR-HydroStress-Cinematic-Intro.html as imperative
 * modules (same numbers): stars, sun sprite, Earth/clouds/atmosphere, procedural NISAR with the
 * deployable boom and 12 m lathe reflector, radar beam + ripples, cloud puffs.
 *
 * r128 → r187 notes
 *  - r128 had no colour management: hex colours and canvas textures were used as LINEAR values.
 *    `lin()` reproduces that (hex components taken as linear-sRGB); canvas textures stay NoColorSpace.
 *  - r128 lights were "legacy" (irradiance × π). Intensities here are the prototype's × π.
 *  - The custom shaders gamma-correct themselves (`tone()`), see ./shaders.ts.
 */
import {
  AdditiveBlending,
  AmbientLight,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CubeCamera,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  HalfFloatType,
  HemisphereLight,
  LatheGeometry,
  LinearSRGBColorSpace,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  PMREMGenerator,
  Points,
  RepeatWrapping,
  RingGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  type Texture,
  TorusGeometry,
  Vector2,
  Vector3,
  WebGLCubeRenderTarget,
  type WebGLRenderer,
} from 'three';

import { clamp } from '@/features/intro/runtime';
import {
  ATMO_FRAG,
  ATMO_VERT,
  BEAM_FRAG,
  BEAM_VERT,
  CLOUDS_FRAG,
  CLOUDS_VERT,
  EARTH_FRAG,
  EARTH_VERT,
  ENV_FRAG,
  ENV_VERT,
  STARS_FRAG,
  STARS_VERT,
} from '@/scene/intro/shaders';

/** r128-style colour: hex components used as linear values (no sRGB decode). */
export const lin = (hex: number): Color =>
  new Color().setRGB(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255, LinearSRGBColorSpace);

/** r128 legacy lights multiplied irradiance by π. */
const LEGACY = Math.PI;

export const easeIO = (x: number): number => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeOutBack = (x: number): number => {
  const c1 = 1.4;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

// value noise (prototype hash / vnoise / fbm), used for the cloud-puff texture
function hash(x: number, y: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
function vnoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, y: number, o: number): number {
  let s = 0;
  let a = 0.5;
  let f = 1;
  let n = 0;
  for (let i = 0; i < o; i++) {
    s += a * vnoise(x * f, y * f);
    n += a;
    a *= 0.5;
    f *= 2.03;
  }
  return s / n;
}

export const SUN_DIR = new Vector3(0.8, 0.38, -0.5).normalize();
export const ER = 130;
export const EC = new Vector3(0, -160, 0);
const Y = new Vector3(0, 1, 0);

type Disposables = { textures: Texture[] };

function canvasTex(
  d: Disposables,
  w: number,
  h: number,
  draw: (x: CanvasRenderingContext2D, w: number, h: number) => void,
  rep?: [number, number],
): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!, w, h);
  const t = new CanvasTexture(c); // NoColorSpace: sampled as-is, like r128 LinearEncoding
  if (rep) {
    t.wrapS = t.wrapT = RepeatWrapping;
    t.repeat.set(rep[0], rep[1]);
  }
  t.anisotropy = 4;
  d.textures.push(t);
  return t;
}

/** Sky-with-sun environment for the PBR satellite (prototype `envScene` → PMREM). */
export function createEnvironment(gl: WebGLRenderer): Texture | null {
  try {
    const envScene = new Scene();
    const geo = new SphereGeometry(10, 48, 24);
    const mat = new ShaderMaterial({
      side: BackSide,
      uniforms: { sunDir: { value: SUN_DIR } },
      vertexShader: ENV_VERT,
      fragmentShader: ENV_FRAG,
    });
    envScene.add(new Mesh(geo, mat));
    const crt = new WebGLCubeRenderTarget(256, { type: HalfFloatType });
    const cc = new CubeCamera(0.1, 100, crt);
    cc.update(gl, envScene);
    const pmrem = new PMREMGenerator(gl);
    const tex = pmrem.fromCubemap(crt.texture).texture;
    pmrem.dispose();
    crt.dispose();
    geo.dispose();
    mat.dispose();
    return tex;
  } catch (e) {
    console.warn('env map skipped', e);
    return null;
  }
}

export function createStars(pixelRatio: number): Points<BufferGeometry, ShaderMaterial> {
  const N = 5000;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const siz = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const t = Math.random() * Math.PI * 2;
    const p = Math.acos(2 * Math.random() - 1);
    const r = 1800;
    pos[i * 3] = r * Math.sin(p) * Math.cos(t);
    pos[i * 3 + 1] = r * Math.cos(p);
    pos[i * 3 + 2] = r * Math.sin(p) * Math.sin(t);
    const w = Math.random();
    col[i * 3] = 0.8 + w * 0.2;
    col[i * 3 + 1] = 0.85 + w * 0.1;
    col[i * 3 + 2] = 1 - w * 0.25;
    siz[i] = Math.pow(Math.random(), 6) * 5 + 0.6;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('starColor', new BufferAttribute(col, 3));
  g.setAttribute('size', new BufferAttribute(siz, 1));
  const m = new ShaderMaterial({
    uniforms: { pr: { value: pixelRatio }, time: { value: 0 } },
    transparent: true,
    depthWrite: false,
    vertexShader: STARS_VERT,
    fragmentShader: STARS_FRAG,
  });
  const s = new Points(g, m);
  s.frustumCulled = false;
  return s;
}

export function createSunSprite(d: Disposables): Sprite {
  const tex = canvasTex(d, 256, 256, (x) => {
    const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.08, 'rgba(255,240,210,.9)');
    g.addColorStop(0.3, 'rgba(255,190,120,.18)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 256, 256);
  });
  tex.anisotropy = 1;
  const sp = new Sprite(new SpriteMaterial({ map: tex, blending: AdditiveBlending, depthWrite: false, transparent: true }));
  sp.position.copy(SUN_DIR).multiplyScalar(1500);
  sp.scale.set(260, 260, 1);
  return sp;
}

export type Earth = { group: Group; uniforms: { sunDir: { value: Vector3 }; time: { value: number } } };

export function createEarth(): Earth {
  const group = new Group();
  group.position.copy(EC);
  const uniforms = { sunDir: { value: SUN_DIR }, time: { value: 0 } };
  group.add(
    new Mesh(
      new SphereGeometry(ER, 192, 128),
      new ShaderMaterial({ uniforms, vertexShader: EARTH_VERT, fragmentShader: EARTH_FRAG }),
    ),
  );
  group.add(
    new Mesh(
      new SphereGeometry(ER * 1.006, 160, 96),
      new ShaderMaterial({
        uniforms,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        vertexShader: CLOUDS_VERT,
        fragmentShader: CLOUDS_FRAG,
      }),
    ),
  );
  group.add(
    new Mesh(
      new SphereGeometry(ER * 1.04, 96, 64),
      new ShaderMaterial({
        uniforms: { sunDir: { value: SUN_DIR } },
        side: BackSide,
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
        vertexShader: ATMO_VERT,
        fragmentShader: ATMO_FRAG,
      }),
    ),
  );
  return { group, uniforms };
}

export type Nisar = {
  group: Group;
  /** Deploy state at intro time `t` (boom unfolds 3.3 → 5.9 s, reflector blooms 5.2 → 7.6 s). */
  setDeploy: (t: number) => void;
  /** Deployed reflector position (rim-plane centre) in satellite space. */
  reflPos: Vector3;
};

export function createNisar(d: Disposables): Nisar {
  const foil = canvasTex(
    d,
    512,
    512,
    (x, w, h) => {
      x.fillStyle = '#888';
      x.fillRect(0, 0, w, h);
      for (let i = 0; i < 900; i++) {
        const g = (90 + Math.random() * 120) | 0;
        x.fillStyle = `rgba(${g},${g},${g},.55)`;
        x.beginPath();
        const cx = Math.random() * w;
        const cy = Math.random() * h;
        const r = 10 + Math.random() * 40;
        for (let k = 0; k < 3; k++) x.lineTo(cx + (Math.random() - 0.5) * r, cy + (Math.random() - 0.5) * r);
        x.fill();
      }
    },
    [2, 2],
  );
  const panelTex = canvasTex(d, 384, 256, (x, w, h) => {
    x.fillStyle = '#070d1f';
    x.fillRect(0, 0, w, h);
    const cw = w / 8;
    const ch = h / 5;
    for (let i = 0; i < 8; i++)
      for (let j = 0; j < 5; j++) {
        const g = x.createLinearGradient(i * cw, j * ch, (i + 1) * cw, (j + 1) * ch);
        g.addColorStop(0, '#13234a');
        g.addColorStop(1, '#0a1430');
        x.fillStyle = g;
        x.fillRect(i * cw + 2, j * ch + 2, cw - 4, ch - 4);
      }
    x.strokeStyle = '#6d7a92';
    x.lineWidth = 2;
    x.strokeRect(1, 1, w - 2, h - 2);
  });
  const meshTex = canvasTex(
    d,
    128,
    128,
    (x, w, h) => {
      x.fillStyle = 'rgba(200,120,72,.24)';
      x.fillRect(0, 0, w, h);
      x.strokeStyle = 'rgba(255,196,140,.6)';
      x.lineWidth = 1;
      for (let i = 0; i <= w; i += 16) {
        x.beginPath();
        x.moveTo(i, 0);
        x.lineTo(i, h);
        x.stroke();
        x.beginPath();
        x.moveTo(0, i);
        x.lineTo(w, i);
        x.stroke();
      }
    },
    [28, 8],
  );

  const gold = new MeshStandardMaterial({
    color: lin(0xf0a21a),
    emissive: lin(0x2a1400),
    metalness: 0.88,
    roughness: 0.34,
    roughnessMap: foil,
    bumpMap: foil,
    bumpScale: 0.015,
    envMapIntensity: 0.9,
  });
  const silver = new MeshStandardMaterial({ color: lin(0xd9dde3), metalness: 1, roughness: 0.25, envMapIntensity: 1.2 });
  const white = new MeshStandardMaterial({ color: lin(0xe8e8e8), metalness: 0.1, roughness: 0.6 });
  const dark = new MeshStandardMaterial({ color: lin(0x17181b), metalness: 0.4, roughness: 0.55 });
  const panelMat = new MeshStandardMaterial({ map: panelTex, metalness: 0.6, roughness: 0.28, envMapIntensity: 1.3 });
  const panelBack = new MeshStandardMaterial({ color: lin(0x8a8f99), metalness: 0.5, roughness: 0.5 });
  const trussMat = new MeshStandardMaterial({ color: lin(0xcfd3da), metalness: 0.8, roughness: 0.35 });

  const rod = (a: Vector3, b: Vector3, r: number, mat: Material, parent: Object3D): Mesh => {
    const dv = new Vector3().subVectors(b, a);
    const m = new Mesh(new CylinderGeometry(r, r, dv.length(), 8), mat);
    m.position.copy(a).addScaledVector(dv, 0.5);
    m.quaternion.setFromUnitVectors(Y, dv.clone().normalize());
    parent.add(m);
    return m;
  };
  const placeRod = (m: Mesh, a: Vector3, b: Vector3): void => {
    const dv = new Vector3().subVectors(b, a);
    const L = dv.length();
    m.position.copy(a).addScaledVector(dv, 0.5);
    m.scale.set(1, Math.max(L, 1e-3), 1);
    m.quaternion.setFromUnitVectors(Y, dv.multiplyScalar(1 / L));
  };
  const V = (x: number, y: number, z: number) => new Vector3(x, y, z);

  const sat = new Group();
  sat.add(new Mesh(new BoxGeometry(1.5, 1.1, 1.1), gold));
  const iris = new Mesh(new CylinderGeometry(0.62, 0.62, 0.75, 8), gold);
  iris.position.set(0, 0.92, 0);
  iris.rotation.y = Math.PI / 8;
  sat.add(iris);
  const feed = new Mesh(new BoxGeometry(0.95, 0.05, 0.62), dark);
  feed.position.set(0, 1.31, 0);
  sat.add(feed);
  for (const s of [-1, 1]) {
    const p = new Mesh(new BoxGeometry(0.04, 0.85, 0.9), white);
    p.position.set(s * 0.77, 0, 0);
    sat.add(p);
  }
  for (let k = 0; k < 3; k++) {
    const st = new Mesh(new CylinderGeometry(0.07, 0.07, 0.2, 12), silver);
    st.rotation.x = Math.PI / 2;
    st.position.set(-0.45 + k * 0.22, -0.25, 0.6);
    sat.add(st);
  }
  const dlink = new Mesh(new SphereGeometry(0.26, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), silver);
  dlink.rotation.x = Math.PI;
  dlink.position.set(0.35, -0.95, 0.15);
  sat.add(dlink);
  rod(V(0.35, -0.55, 0.15), V(0.35, -0.95, 0.15), 0.03, silver, sat);
  for (const [x, z] of [
    [-0.5, -0.3],
    [0.5, -0.3],
    [0, 0.35],
  ] as const)
    rod(V(x * 0.8, -0.55, z), V(x, -0.9, z * 1.2), 0.02, trussMat, sat);
  for (const s of [-1, 1]) {
    rod(V(s * 0.75, 0, 0), V(s * 1.25, 0, 0), 0.035, trussMat, sat);
    for (let i = 0; i < 3; i++) {
      const g = new Group();
      g.position.set(s * (1.85 + i * 1.22), 0, 0);
      g.rotation.x = 1.22;
      g.add(
        new Mesh(new BoxGeometry(1.16, 0.03, 0.82), [panelBack, panelBack, panelMat, panelBack, panelBack, panelBack]),
      );
      sat.add(g);
    }
  }

  // boom (deployable)
  const BOOM_D = [V(0.3, 1.3, -0.05), V(0.85, 2.5, 0.45), V(0.45, 3.5, 0.35), V(0.9, 4.38, 0.06)];
  const BOOM_S = [V(0.3, 1.3, -0.05), V(0.6, 1.75, 0.3), V(0.2, 2.05, 0.12), V(0.5, 2.32, 0.05)];
  const boomRods = [0, 1, 2].map(() => {
    const m = new Mesh(new CylinderGeometry(0.075, 0.075, 1, 10), dark);
    sat.add(m);
    return m;
  });
  const boomJ = [0, 1, 2].map(() => {
    const m = new Mesh(new SphereGeometry(0.13, 16, 12), gold);
    sat.add(m);
    return m;
  });

  // reflector (group origin = centre of the rim's lower plane)
  const RR = 3;
  const refl = new Group();
  sat.add(refl);
  const NB = 24;
  const top: Vector3[] = [];
  const bot: Vector3[] = [];
  for (let i = 0; i < NB; i++) {
    const a = (i / NB) * Math.PI * 2;
    top.push(V(RR * Math.cos(a), 0.5, RR * Math.sin(a)));
    bot.push(V(RR * Math.cos(a), 0, RR * Math.sin(a)));
  }
  for (let i = 0; i < NB; i++) {
    rod(top[i]!, bot[i]!, 0.018, trussMat, refl);
    const n = (i + 1) % NB;
    rod(i % 2 ? bot[i]! : top[i]!, i % 2 ? top[n]! : bot[n]!, 0.016, trussMat, refl);
    const k = new Mesh(new SphereGeometry(0.04, 8, 6), gold);
    k.position.copy(top[i]!);
    refl.add(k);
  }
  for (const y of [0, 0.5]) {
    const t = new Mesh(new TorusGeometry(RR, 0.022, 6, 96), trussMat);
    t.rotation.x = Math.PI / 2;
    t.position.y = y;
    refl.add(t);
  }
  const prof: Vector2[] = [];
  for (let k = 0; k <= 24; k++) {
    const r = (RR * k) / 24;
    prof.push(new Vector2(Math.max(r, 0.001), -0.55 * (1 - (r / RR) ** 2)));
  }
  const meshMat = new MeshStandardMaterial({
    map: meshTex,
    transparent: true,
    side: DoubleSide,
    depthWrite: false,
    metalness: 0.75,
    roughness: 0.45,
    envMapIntensity: 1.2,
  });
  refl.add(new Mesh(new LatheGeometry(prof, 96), meshMat));
  const ATTACH = V(0.9, 0, 2.86); // rim point that meets the boom
  const reflPos = new Vector3().subVectors(BOOM_D[3]!, ATTACH);
  const tmpV = [0, 1, 2, 3].map(() => new Vector3());

  const setDeploy = (t: number): void => {
    const b = easeIO(clamp((t - 3.3) / 2.6, 0, 1)); // boom unfolds
    const r = clamp((t - 5.2) / 2.4, 0, 1);
    const rs = r <= 0 ? 0 : easeOutBack(r); // reflector blooms
    for (let i = 0; i < 4; i++) tmpV[i]!.lerpVectors(BOOM_S[i]!, BOOM_D[i]!, b);
    for (let i = 0; i < 3; i++) {
      placeRod(boomRods[i]!, tmpV[i]!, tmpV[i + 1]!);
      boomJ[i]!.position.copy(tmpV[i + 1]!);
    }
    const s = 0.06 + 0.94 * rs;
    refl.scale.setScalar(s);
    refl.position.copy(tmpV[3]!).addScaledVector(ATTACH, -s);
    refl.rotation.y = (1 - Math.min(rs, 1)) * 0.9;
    meshMat.opacity = clamp(rs, 0, 1);
  };

  return { group: sat, setDeploy, reflPos };
}

export type Beam = {
  group: Group;
  uniforms: { time: { value: number }; opacity: { value: number } };
  ripples: Mesh<RingGeometry, MeshBasicMaterial>[];
  beamStart: Vector3;
  beamEnd: Vector3;
  tgtDir: Vector3;
};

/** Radar beam from the reflector down to the target, ground ripples, and the cloud puffs the dive punches through. */
export function createBeam(d: Disposables, reflPos: Vector3): Beam {
  const group = new Group();
  const tgtDir = new Vector3(-2, 130.5, -15).normalize();
  const beamEnd = EC.clone().addScaledVector(tgtDir, ER * 1.001);
  const beamStart = reflPos.clone().add(new Vector3(0, -0.55, 0));
  const bd = new Vector3().subVectors(beamStart, beamEnd);
  const uniforms = { time: { value: 0 }, opacity: { value: 0 } };
  const beam = new Mesh(
    new CylinderGeometry(1.1, 7.5, bd.length(), 64, 1, true),
    new ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      blending: AdditiveBlending,
      vertexShader: BEAM_VERT,
      fragmentShader: BEAM_FRAG,
    }),
  );
  beam.position.copy(beamEnd).addScaledVector(bd, 0.5);
  beam.quaternion.setFromUnitVectors(Y, bd.clone().normalize());
  group.add(beam);

  const ripples = [0, 1, 2].map(() => {
    const m = new Mesh(
      new RingGeometry(0.92, 1, 96),
      new MeshBasicMaterial({
        color: lin(0x5ff3ff),
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    m.position.copy(beamEnd).addScaledVector(tgtDir, 0.08);
    m.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), tgtDir);
    group.add(m);
    return m;
  });

  const cloudTex = canvasTex(d, 128, 128, (x, w, h) => {
    const img = x.createImageData(w, h);
    for (let y = 0; y < h; y++)
      for (let X = 0; X < w; X++) {
        const dd = Math.hypot(X - 64, y - 64) / 64;
        const n = fbm(X / 22, y / 22, 4);
        const a = clamp((1 - dd) * 1.6 * (n * 1.3 - 0.15), 0, 1);
        const j = (y * w + X) * 4;
        img.data[j] = img.data[j + 1] = img.data[j + 2] = 245;
        img.data[j + 3] = a * 255;
      }
    x.putImageData(img, 0, 0);
  });
  const tang1 = new Vector3().crossVectors(tgtDir, new Vector3(1, 0, 0)).normalize();
  const tang2 = new Vector3().crossVectors(tgtDir, tang1);
  const puffMat = new SpriteMaterial({ map: cloudTex, transparent: true, depthWrite: false, opacity: 0.95 });
  for (let k = 0; k < 18; k++) {
    const sp = new Sprite(puffMat);
    sp.position
      .copy(beamEnd)
      .addScaledVector(tgtDir, 0.5 + Math.random() * 1.6)
      .addScaledVector(tang1, (Math.random() - 0.5) * 7)
      .addScaledVector(tang2, (Math.random() - 0.5) * 7);
    const s = 2 + Math.random() * 3.5;
    sp.scale.set(s, s, 1);
    group.add(sp);
  }
  return { group, uniforms, ripples, beamStart, beamEnd, tgtDir };
}

export type IntroWorld = {
  root: Group;
  environment: Texture | null;
  stars: Points<BufferGeometry, ShaderMaterial>;
  earth: Earth;
  nisar: Nisar;
  beam: Beam;
  dispose: () => void;
};

export function createIntroWorld(gl: WebGLRenderer): IntroWorld {
  const d: Disposables = { textures: [] };
  const root = new Group();
  root.name = 'intro-world';

  const environment = createEnvironment(gl);

  root.add(new AmbientLight(0xffffff, 0.12 * LEGACY));
  const sunL = new DirectionalLight(lin(0xfff3e0), 2.4 * LEGACY);
  sunL.position.copy(SUN_DIR).multiplyScalar(50);
  root.add(sunL);
  root.add(new HemisphereLight(lin(0x02030a), lin(0x3b78c4), 0.55 * LEGACY));

  const stars = createStars(gl.getPixelRatio());
  root.add(stars);
  root.add(createSunSprite(d));
  const earth = createEarth();
  root.add(earth.group);
  const nisar = createNisar(d);
  root.add(nisar.group);
  const beam = createBeam(d, nisar.reflPos);
  root.add(beam.group);
  nisar.setDeploy(0);

  const dispose = (): void => {
    root.traverse((o) => {
      const m = o as Mesh;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      mats.forEach((x) => x.dispose());
    });
    d.textures.forEach((t) => t.dispose());
    environment?.dispose();
  };

  return { root, environment, stars, earth, nisar, beam, dispose };
}
