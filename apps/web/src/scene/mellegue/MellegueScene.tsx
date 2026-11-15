import { PerformanceMonitor } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BackSide, Color, HalfFloatType, type Group, Mesh, ShaderMaterial, SphereGeometry, WebGLRenderTarget } from 'three';

import { dataQueries, useDataSource } from '@/data/hooks';
import { intro } from '@/features/intro/runtime';
import { loadTerrainAssets, type TerrainAssets } from '@/scene/mellegue/assets';
import { CameraRig } from '@/scene/mellegue/CameraRig';
import { DamCrest, FlowPath, LakeOutline, VillageLabels } from '@/scene/mellegue/overlays';
import { HAZE_DAY, HAZE_NIGHT } from '@/scene/mellegue/look';
import { Terrain } from '@/scene/mellegue/Terrain';
import { lowerTier, raiseTier } from '@/scene/quality';
import { useSceneStatus } from '@/scene/status';
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
        useSceneStatus.setState({ terrainError: true });
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
    useSceneStatus.setState({ terrainReady: true });
  }, [assets, camera, gl, scene]);

  if (assets) assets.frame.exag = exag; // before markers resample heights

  return (
    <group ref={groupRef} visible={active}>
      <Sky />
      {assets ? <Terrain assets={assets} /> : null}
      {assets ? (
        <>
          <LakeOutline assets={assets} />
          <FlowPath assets={assets} />
        </>
      ) : null}
      {assets && active ? (
        <>
          <DamCrest assets={assets} />
          <VillageLabels assets={assets} />
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
