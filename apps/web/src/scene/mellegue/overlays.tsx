/**
 * Vector overlays draped on the Mellègue terrain: the reservoir outline, the dam crest and its pin,
 * the 101 km flow path with its reach labels, and the village labels. Every geometry and name comes
 * from the bundle's vector layers (EPSG:32632), never from the code.
 */
import { Html } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Color, type Mesh, type ShaderMaterial, Vector2 } from 'three';

import { DAM_LONLAT, type SceneFrame, type Vec3 } from '@/scene/coords';
import { floodRuntime, handAt } from '@/scene/mellegue/flood';
import { LabelLayer, type LabelSpec } from '@/scene/mellegue/labels';
import { drape, lineMaterial, lineMesh } from '@/scene/mellegue/lines';
import { sceneVectors } from '@/scene/mellegue/sceneVectors';
import type { TerrainAssets } from '@/scene/mellegue/assets';
import { firstLine, flowpathLine, type FlowpathProps, type Position, useVectorLayer } from '@/scene/mellegue/vectors';
import { useAppStore } from '@/store/app';
import { tokens } from '@/styles/tokens';

const RIVER = '#5ff3ff';
const NIGHT_LIGHTS = new Color('#ffcf7a');
const DAY_CREST = new Color('#e9fdff');

type Props = { assets: TerrainAssets };

function useSurface(frame: SceneFrame) {
  const quality = useAppStore((s) => s.quality);
  const exag = useAppStore((s) => s.exag);
  // re-drape when the mesh or the exaggeration changes
  return useMemo(() => ({ key: `${quality}:${exag}`, h: (x: number, z: number) => frame.surfaceHeight(x, z) }), [frame, quality, exag]);
}

/** Per-frame uniforms shared by every screen-space line. */
function tickLine(m: ShaderMaterial, res: Vector2, t: number, dpr: number, widthPx: number) {
  const u = m.uniforms;
  (u.uResolution!.value as Vector2).copy(res);
  u.uTime!.value = t;
  u.uWidth!.value = widthPx * dpr;
}

function useCanvasParent(): HTMLElement | null {
  return useThree((s) => s.gl.domElement.parentElement);
}

// ------------------------------------------------------------------------------- lake outline

type Ring = Position[];

function outerRings(geom: { type: string; coordinates: unknown }): Ring[] {
  if (geom.type === 'Polygon') return [(geom.coordinates as Ring[])[0]!];
  if (geom.type === 'MultiPolygon') return (geom.coordinates as Ring[][]).map((p) => p[0]!);
  return [];
}

/** Reservoir extent before the failure (lake_max), a crisp teal line on the rendered surface. */
export function LakeOutline({ assets }: Props) {
  const fc = useVectorLayer(assets.manifest, 'lake_max');
  const surf = useSurface(assets.frame);
  const gl = useThree((s) => s.gl);
  const res = useMemo(() => new Vector2(), []);
  const { meshes, material } = useMemo(() => {
    const material = lineMaterial({ color: tokens.color.teal, widthPx: 2.2, opacity: 0.95, lift: 0.002 });
    if (!fc) return { meshes: [] as Mesh[], material };
    const meshes: Mesh[] = [];
    for (const f of fc.features) {
      for (const ring of outerRings(f.geometry)) {
        const xz = ring.map((c) => {
          const [x, , z] = assets.frame.utmToScene(c[0]!, c[1]!, assets.grid.z_min);
          return [x, z] as const;
        });
        const { points } = drape(xz, 0.03, surf.h, 0.003);
        meshes.push(lineMesh(points, material.clone()));
      }
    }
    return { meshes, material };
  }, [assets, fc, surf]);
  useEffect(
    () => () => {
      meshes.forEach((m) => {
        m.geometry.dispose();
        (m.material as ShaderMaterial).dispose();
      });
      material.dispose();
    },
    [meshes, material],
  );
  useFrame((state) => {
    gl.getDrawingBufferSize(res);
    const night = useAppStore.getState().act === 2;
    for (const m of meshes) {
      const mat = m.material as ShaderMaterial;
      tickLine(mat, res, state.clock.elapsedTime, gl.getPixelRatio(), 2.2);
      mat.uniforms.uOpacity!.value = night ? 0.45 : 0.95;
    }
  });
  return (
    <>
      {meshes.map((m) => (
        <primitive key={m.uuid} object={m} />
      ))}
    </>
  );
}

// ------------------------------------------------------------------------------- dam crest + pin

/** The dam crest digitised by the team (dam_line), drawn bright; the pin sits on its midpoint. */
export function DamCrest({ assets }: Props) {
  const fc = useVectorLayer(assets.manifest, 'dam_line');
  const surf = useSurface(assets.frame);
  const gl = useThree((s) => s.gl);
  const res = useMemo(() => new Vector2(), []);
  const crest = useMemo(() => {
    const line = firstLine(fc);
    if (!line || line.length < 2) return null;
    const xz = line.map(([x, y]) => {
      const p = assets.frame.utmToScene(x, y, assets.grid.z_min);
      return [p[0], p[2]] as const;
    });
    const { points, dist } = drape(xz, 0.02, surf.h, 0.006);
    const total = dist[dist.length - 1] ?? 0;
    let mid = points[0]!;
    for (let i = 0; i < dist.length; i++) {
      if (dist[i]! >= total / 2) {
        mid = points[i]!;
        break;
      }
    }
    const material = lineMaterial({ color: '#e9fdff', widthPx: 5, core: 0.5, halo: 0.8, glow: 0.6, lift: 0.003 });
    return { mesh: lineMesh(points, material), material, mid };
  }, [assets, fc, surf]);
  useEffect(() => {
    sceneVectors.damCrest = crest?.mid ?? null;
    return () => {
      crest?.mesh.geometry.dispose();
      crest?.material.dispose();
    };
  }, [crest]);

  const nightK = useRef(0);
  useFrame((state, dt) => {
    if (!crest) return;
    gl.getDrawingBufferSize(res);
    const u = crest.material.uniforms;
    tickLine(crest.material, res, state.clock.elapsedTime, gl.getPixelRatio(), 5);
    const target = useAppStore.getState().act === 2 ? 1 : 0;
    nightK.current += (target - nightK.current) * Math.min(1, dt * 1.5);
    // night: the crest lights are the only warm thing in the scene (HDR → bloom on high tier)
    (u.uColor!.value as Color).copy(DAY_CREST).lerp(NIGHT_LIGHTS, nightK.current).multiplyScalar(1 + nightK.current * 1.4);
  });

  // fallback: the dam point from config until the crest has loaded
  const fallback = useMemo(() => assets.frame.lonLatToScene(DAM_LONLAT[0], DAM_LONLAT[1]), [assets, surf]); // eslint-disable-line react-hooks/exhaustive-deps
  const pin = crest?.mid ?? fallback;
  return (
    <>
      {crest ? <primitive object={crest.mesh} /> : null}
      <DamPin pos={pin} />
    </>
  );
}

function DamPin({ pos }: { pos: Vec3 }) {
  return (
    <group position={pos}>
      <mesh position={[0, 0.3, 0]} renderOrder={7}>
        <cylinderGeometry args={[0.008, 0.008, 0.6, 6]} />
        <meshBasicMaterial color={tokens.color.teal} toneMapped={false} transparent opacity={0.9} depthTest={false} />
      </mesh>
      <Html position={[0, 0.62, 0]} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
        <div
          style={{
            fontFamily: tokens.font.mono,
            fontSize: 11,
            letterSpacing: '.12em',
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
            color: tokens.color.ink,
            background: 'rgba(3,5,10,.74)',
            border: '1px solid rgba(95, 243, 255, 0.35)',
            borderRadius: 6,
            padding: '5px 9px',
            transform: 'translateY(-60%)',
          }}
        >
          Mellègue dam · 1954
        </div>
      </Html>
    </group>
  );
}

// ------------------------------------------------------------------------------- flow path

/** Point at `km` along a polyline whose vertices carry cumulative distances. */
function alongPath(xz: readonly (readonly [number, number])[], dist: readonly number[], km: number): [number, number] {
  if (xz.length === 0) return [0, 0];
  for (let i = 1; i < xz.length; i++) {
    if (dist[i]! >= km) {
      const t = (km - dist[i - 1]!) / Math.max(1e-6, dist[i]! - dist[i - 1]!);
      const a = xz[i - 1]!;
      const b = xz[i]!;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
  }
  const last = xz[xz.length - 1]!;
  return [last[0], last[1]];
}

/**
 * The 101 km flow path: a glowing river-cyan line with pulses travelling downstream, a draw-on
 * when the layer appears, and labels at the reach breaks named in flowpath.geojson.
 */
export function FlowPath({ assets }: Props) {
  const fc = useVectorLayer<FlowpathProps>(assets.manifest, 'flowpath');
  const surf = useSurface(assets.frame);
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const parent = useCanvasParent();
  const res = useMemo(() => new Vector2(), []);

  const path = useMemo(() => {
    const fl = flowpathLine(fc);
    if (!fl || fl.coords.length < 2) return null;
    const xz = fl.coords.map(([x, y]) => {
      const p = assets.frame.utmToScene(x, y, assets.grid.z_min);
      return [p[0], p[2]] as [number, number];
    });
    // cumulative distance: the file's own vertex distances when present (= its km labels)
    let dist = fl.props.vertex_dist_km;
    if (!dist || dist.length !== xz.length) {
      dist = [0];
      for (let i = 1; i < xz.length; i++) dist.push(dist[i - 1]! + Math.hypot(xz[i]![0] - xz[i - 1]![0], xz[i]![1] - xz[i - 1]![1]));
    }
    const { points } = drape(xz, 0.08, surf.h, 0.006);
    const material = lineMaterial({
      color: RIVER,
      widthPx: 9,
      core: 0.34,
      halo: 0.75,
      glow: 1.5,
      pulseKm: 8,
      speedKmS: 4,
      lift: 0.003,
      opacity: 0,
    });
    const mesh = lineMesh(points, material);
    // ground samples every 2 km for the valley flight
    const valley: Vec3[] = [];
    const total = dist[dist.length - 1]!;
    for (let km = 0; km <= total; km += 2) {
      const [x, z] = alongPath(xz, dist, km);
      valley.push([x, assets.frame.sampleHeight(x, z), z]);
    }
    const labels: LabelSpec[] = (fl.props.reach_breaks ?? []).map((b) => {
      const [x, z] = alongPath(xz, dist, b.dist_km);
      return {
        id: `reach-${b.name}`,
        text: b.name,
        sub: `km ${b.dist_km.toFixed(1)}`,
        pos: [x, surf.h(x, z) + 0.05, z] as Vec3,
        kind: 'reach' as const,
      };
    });
    return { mesh, material, valley, labels };
  }, [assets, fc, surf]);

  useEffect(() => {
    sceneVectors.valley = path?.valley ?? null;
    sceneVectors.reachNames = new Set((path?.labels ?? []).map((l) => l.text.trim().toLowerCase()));
    return () => {
      sceneVectors.reachNames = new Set();
      path?.mesh.geometry.dispose();
      path?.material.dispose();
    };
  }, [path]);

  const layer = useMemo(() => (parent ? new LabelLayer(parent) : null), [parent]);
  useEffect(() => () => layer?.dispose(), [layer]);
  useEffect(() => {
    layer?.set(path?.labels ?? []);
  }, [layer, path]);

  const vis = useRef(0);
  const draw = useRef(0);
  useFrame((state, dt) => {
    if (!path) return;
    const s = useAppStore.getState();
    const on = s.layers.flowpath && s.stageScene === 'mellegue';
    const u = path.material.uniforms;
    gl.getDrawingBufferSize(res);
    tickLine(path.material, res, s.reducedMotion ? 0 : state.clock.elapsedTime, gl.getPixelRatio(), 9);
    vis.current += ((on ? 1 : 0) - vis.current) * Math.min(1, dt * 3);
    if (!on) draw.current = 0;
    else draw.current = s.reducedMotion ? 1 : Math.min(1, draw.current + dt / 2.6);
    u.uDraw!.value = draw.current < 1 ? 1 - Math.pow(1 - draw.current, 2) : 1;
    u.uOpacity!.value = vis.current;
    u.uGlow!.value = s.reducedMotion ? 0 : 1.5;
    path.mesh.visible = vis.current > 0.01;
    layer?.update(camera, size.width, size.height, () => (on && draw.current > 0.6 ? 1 : 0), 160, true);
  });

  return path ? <primitive object={path.mesh} /> : null;
}

// ------------------------------------------------------------------------------- villages

type VillageProps = { name?: string | null; name_fr?: string | null; name_en?: string | null; place?: string; population?: number };

const PLACE_RANK: Record<string, number> = { city: 4, town: 3, village: 2, hamlet: 1 };

function pointInRing(x: number, y: number, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0]!;
    const yi = ring[i]![1]!;
    const xj = ring[j]![0]!;
    const yj = ring[j]![1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inPolygons(x: number, y: number, polys: Position[][][]): boolean {
  return polys.some((poly) => pointInRing(x, y, poly[0]!) && !poly.slice(1).some((hole) => pointInRing(x, y, hole)));
}

type Village = { id: string; name: string; rank: number; pop: number; pos: Vec3; u: number; v: number; inCorridor: boolean };

/** Is the village (image UV) reached by the flood shown now? Checks a ±2 px window (≈ ±90 m). */
function reached(vl: Village, grid: [number, number]): boolean {
  if (floodRuntime.show === 'hand' && floodRuntime.hand) {
    const h = floodRuntime.hand;
    const px = 1 / h.width;
    const py = 1 / h.height;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) if (handAt(h, vl.u + dx * px, vl.v + dy * py) <= floodRuntime.handH) return true;
    return false;
  }
  if (floodRuntime.show === 'anuga' && floodRuntime.anuga) {
    const { rect, data } = floodRuntime.anuga.maxCpu;
    const cx = Math.floor(vl.u * grid[0]) - rect.x;
    const cy = Math.floor(vl.v * grid[1]) - rect.y;
    const min = Math.ceil(0.1 / floodRuntime.anuga.scaleM);
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && y >= 0 && x < rect.w && y < rect.h && data[y * rect.w + x]! >= min) return true;
      }
  }
  return false;
}

/**
 * Village labels (layers.villages): places inside the HAND corridor, plus any place the current
 * flood reaches (dot tinted amber for HAND, blue for ANUGA). Greedy declutter, wet places first.
 */
export function VillageLabels({ assets }: Props) {
  const villages = useVectorLayer<VillageProps>(assets.manifest, 'villages');
  const corridor = useVectorLayer(assets.manifest, 'corridor');
  const surf = useSurface(assets.frame);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const parent = useCanvasParent();

  const list = useMemo(() => {
    if (!villages || !corridor) return [];
    const polys: Position[][][] = [];
    for (const f of corridor.features) {
      if (f.geometry.type === 'Polygon') polys.push(f.geometry.coordinates);
      else if (f.geometry.type === 'MultiPolygon') polys.push(...f.geometry.coordinates);
    }
    const out: Village[] = [];
    villages.features.forEach((f, i) => {
      if (f.geometry.type !== 'Point') return;
      const [x, y] = f.geometry.coordinates as [number, number];
      const p = f.properties;
      const name = p.name_fr || p.name_en || p.name;
      if (!name) return;
      const s = assets.frame.utmToScene(x, y, assets.grid.z_min);
      const [u, v] = assets.frame.sceneToUv(s[0], s[2]);
      if (u < 0 || v < 0 || u > 1 || v > 1) return;
      out.push({
        id: `v${i}`,
        name,
        rank: PLACE_RANK[p.place ?? ''] ?? 1,
        pop: p.population ?? 0,
        pos: [s[0], surf.h(s[0], s[2]) + 0.02, s[2]],
        u,
        v,
        inCorridor: inPolygons(x, y, polys),
      });
    });
    return out;
  }, [assets, corridor, surf, villages]);

  const layer = useMemo(() => (parent ? new LabelLayer(parent) : null), [parent]);
  useEffect(() => () => layer?.dispose(), [layer]);

  const wet = useRef(new Set<string>());
  const wetKey = useRef('∅');
  const nextCheck = useRef(0);
  const shownIds = useRef(new Set<string>());

  useFrame((state) => {
    if (!layer) return;
    const s = useAppStore.getState();
    const grid = assets.grid.size_px as [number, number];
    if (state.clock.elapsedTime >= nextCheck.current) {
      nextCheck.current = state.clock.elapsedTime + 0.5;
      const w = new Set<string>();
      if (s.layers.flood) for (const vl of list) if (reached(vl, grid)) w.add(vl.id);
      // a place already named on the flow path (e.g. Bou Salem) is labelled once, by the path
      const dup = s.layers.flowpath ? sceneVectors.reachNames : null;
      const key = `${list.length}:${floodRuntime.show}:${dup ? [...dup].join('|') : '-'}:${[...w].join(',')}`;
      if (key !== wetKey.current) {
        wetKey.current = key;
        wet.current = w;
        // candidates, by priority: reached first, then the bigger places
        const cands = list
          .filter((vl) => !dup?.has(vl.name.trim().toLowerCase()))
          .filter((vl) => w.has(vl.id) || (vl.inCorridor && vl.rank >= 2))
          .sort((a, b) => Number(w.has(b.id)) - Number(w.has(a.id)) || b.rank - a.rank || b.pop - a.pop);
        shownIds.current = new Set(cands.map((c) => c.id));
        layer.set(
          cands.map((c) => ({ id: c.id, text: c.name, pos: c.pos, kind: c.rank >= 3 ? ('town' as const) : ('village' as const) })),
        );
        const tint = floodRuntime.show === 'anuga' ? tokens.color.flood[0] : tokens.color.alert;
        for (const c of cands) layer.tone(c.id, w.has(c.id) ? tint : null);
      }
    }
    const on = s.layers.villages;
    layer.update(camera, size.width, size.height, () => (on ? 1 : 0), 90, true);
  });
  return null;
}

