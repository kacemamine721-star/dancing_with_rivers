import { Html, PerformanceMonitor } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BackSide,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  HalfFloatType,
  type Group,
  LineBasicMaterial,
  LineLoop,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  ShaderMaterial,
  SphereGeometry,
  WebGLRenderTarget,
} from 'three';

import { dataQueries, useDataSource } from '@/data/hooks';
import { intro } from '@/features/intro/runtime';
import { DAM_LONLAT, type SceneFrame } from '@/scene/coords';
import { loadTerrainAssets, type TerrainAssets } from '@/scene/mellegue/assets';
import { CameraRig } from '@/scene/mellegue/CameraRig';
import { HAZE_DAY, HAZE_NIGHT } from '@/scene/mellegue/look';
import { Terrain } from '@/scene/mellegue/Terrain';
import { lowerTier, raiseTier } from '@/scene/quality';
import skyFrag from '@/scene/shaders/sky.frag.glsl';
import skyVert from '@/scene/shaders/sky.vert.glsl';
import { useAppStore } from '@/store/app';
import { tokens } from '@/styles/tokens';

/** Dark gradient sky with haze at the horizon; follows the camera. */
function Sky() {
  const mesh = useMemo(() => {
    const m = new Mesh(
      new SphereGeometry(1, 32, 16),
      new ShaderMaterial({
        vertexShader: skyVert,
        fragmentShader: skyFrag,
        side: BackSide,
        depthWrite: false,
        uniforms: {
          uHazeDay: { value: HAZE_DAY },
          uHazeNight: { value: HAZE_NIGHT },
          uZenith: { value: new Color(tokens.color.bg) },
          uNight: { value: 0 },
        },
      }),
    );
    m.frustumCulled = false;
    m.renderOrder = -10;
    return m;
  }, []);
  useEffect(
    () => () => {
      mesh.geometry.dispose();
      (mesh.material as ShaderMaterial).dispose();
    },
    [mesh],
  );
  useFrame((_, dt) => {
    const u = (mesh.material as ShaderMaterial).uniforms.uNight!;
    const target = useAppStore.getState().act === 2 ? 1 : 0;
    u.value += (target - (u.value as number)) * Math.min(1, dt * 1.5);
  });
  return <primitive object={mesh} />;
}

/** Pin at the dam crest with its label (docs/04 §7.2). */
function DamMarker({ frame, exag }: { frame: SceneFrame; exag: number }) {
  const pin = useMemo(() => {
    const teal = new MeshBasicMaterial({ color: tokens.color.teal, toneMapped: false });
    const stem = new Mesh(new CylinderGeometry(0.012, 0.012, 0.9, 6), teal);
    stem.position.y = 0.45;
    const ring = new Mesh(
      new RingGeometry(0.13, 0.17, 48),
      new MeshBasicMaterial({ color: tokens.color.teal, toneMapped: false, transparent: true, opacity: 0.85, depthTest: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    ring.renderOrder = 5;
    return { stem, ring, teal };
  }, []);
  useEffect(
    () => () => {
      pin.stem.geometry.dispose();
      pin.ring.geometry.dispose();
      (pin.ring.material as MeshBasicMaterial).dispose();
      pin.teal.dispose();
    },
    [pin],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps -- exag changes the sampled height
  const pos = useMemo(() => frame.lonLatToScene(DAM_LONLAT[0], DAM_LONLAT[1]), [frame, exag]);
  return (
    <group position={pos}>
      <primitive object={pin.stem} />
      <primitive object={pin.ring} />
      <Html position={[0, 0.95, 0]} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
        <div
          style={{
            fontFamily: tokens.font.mono,
            fontSize: 11,
            letterSpacing: '.12em',
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
            color: tokens.color.ink,
            background: 'rgba(3,5,10,.72)',
            border: `1px solid ${tokens.color.tealDim}`,
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

type Ring = number[][];
type LakeGeoJson = { features: { geometry: { type: string; coordinates: unknown } }[] };

function outerRings(gj: LakeGeoJson): Ring[] {
  const rings: Ring[] = [];
  for (const f of gj.features) {
    const g = f.geometry;
    if (g.type === 'Polygon') rings.push((g.coordinates as Ring[])[0]!);
    else if (g.type === 'MultiPolygon') for (const poly of g.coordinates as Ring[][]) rings.push(poly[0]!);
  }
  return rings;
}

/** Reservoir extent before the failure (vectors/lake_max.geojson, UTM 32N metres), draped as a teal line. */
function LakeOutline({ frame, assets, exag }: { frame: SceneFrame; assets: TerrainAssets; exag: number }) {
  const ds = useDataSource();
  const file = assets.manifest.layers.find((l) => l.id === 'lake_max')?.file;
  const { data } = useQuery({
    queryKey: ['data', 'vector', file],
    enabled: Boolean(file),
    staleTime: Infinity,
    queryFn: async (): Promise<LakeGeoJson> => {
      const res = await fetch(ds.fileUrl(file!));
      if (!res.ok) throw new Error(`lake_max HTTP ${res.status}`);
      return (await res.json()) as LakeGeoJson;
    },
  });
  const lines = useMemo(() => {
    if (!data) return [];
    const mat = new LineBasicMaterial({ color: tokens.color.teal, transparent: true, opacity: 0.9, toneMapped: false });
    return outerRings(data).map((ring) => {
      const pts: number[] = [];
      for (const c of ring) {
        const [x, y, z] = frame.utmToScene(c[0]!, c[1]!);
        pts.push(x, y + 0.012, z);
      }
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(pts, 3));
      return new LineLoop(g, mat);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- exag changes the sampled heights
  }, [data, frame, exag]);
  useEffect(
    () => () => {
      lines.forEach((l) => l.geometry.dispose());
      (lines[0]?.material as LineBasicMaterial | undefined)?.dispose();
    },
    [lines],
  );
  return (
    <>
      {lines.map((l) => (
        <primitive key={l.uuid} object={l} />
      ))}
    </>
  );
}

/**
 * Scene 2 of the persistent Canvas: the real Mellègue terrain. Mounted from the start (hidden) so
 * the rasters are fetched, decoded, uploaded and compiled during the intro; `active` flips it on
 * under the dive's white flash.
 */
export function MellegueScene({ active }: { active: boolean }) {
  const ds = useDataSource();
  const qc = useQueryClient();
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const exag = useAppStore((s) => s.exag);
  const groupRef = useRef<Group>(null);
  const [assets, setAssets] = useState<TerrainAssets | null>(null);

  useEffect(() => {
    let cancelled = false;
    let loaded: TerrainAssets | null = null;
    void (async () => {
      try {
        const manifest = await qc.fetchQuery(dataQueries.manifest(ds));
        const grid = await qc.fetchQuery(dataQueries.grid(ds));
        const a = await loadTerrainAssets(ds, manifest, grid, useAppStore.getState().exag);
        if (cancelled) {
          a.height.dispose();
          a.base.dispose();
          a.hill.dispose();
          a.water.dispose();
          return;
        }
        loaded = a;
        for (const t of [a.height, a.base, a.hill, a.water]) gl.initTexture(t);
        setAssets(a);
        intro.setReadiness({ dataReady: true });
      } catch (e) {
        console.error('Terrain failed to load', e);
        // never block the intro on the terrain
        intro.setReadiness({ dataReady: true, terrainReady: true });
      }
    })();
    return () => {
      cancelled = true;
      if (loaded) {
        loaded.height.dispose();
        loaded.base.dispose();
        loaded.hill.dispose();
        loaded.water.dispose();
      }
    };
  }, [ds, gl, qc]);

  // compile the terrain program while it is still hidden, so the swap has no hitch
  useEffect(() => {
    if (!assets) return;
    const g = groupRef.current;
    if (g) {
      // Warm both program variants: canvas (low tier, no composer) and render target (composer:
      // linear output, no tone mapping), by rendering the terrain once off screen.
      const was = g.visible;
      const others = scene.children.filter((o) => o !== g && o.visible);
      g.visible = true;
      gl.compile(scene, camera);
      others.forEach((o) => (o.visible = false));
      const rt = new WebGLRenderTarget(64, 64, { type: HalfFloatType });
      const prev = gl.getRenderTarget();
      gl.setRenderTarget(rt);
      gl.render(scene, camera);
      gl.setRenderTarget(prev);
      rt.dispose();
      others.forEach((o) => (o.visible = true));
      g.visible = was;
    }
    intro.setReadiness({ terrainReady: true });
  }, [assets, camera, gl, scene]);

  if (assets) assets.frame.exag = exag; // before markers resample heights

  return (
    <group ref={groupRef} visible={active}>
      <Sky />
      {assets ? <Terrain assets={assets} /> : null}
      {assets ? <LakeOutline frame={assets.frame} assets={assets} exag={exag} /> : null}
      {assets && active ? (
        <>
          <DamMarker frame={assets.frame} exag={exag} />
          <CameraRig frame={assets.frame} />
          <PerformanceMonitor
            flipflops={3}
            onDecline={() => {
              const s = useAppStore.getState();
              s.setQuality(lowerTier(s.quality));
            }}
            onIncline={() => {
              const s = useAppStore.getState();
              s.setQuality(raiseTier(s.quality));
            }}
            onFallback={() => useAppStore.getState().setQuality('low')}
          />
        </>
      ) : null}
    </group>
  );
}
