import { Bloom, EffectComposer, Noise, Vignette } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';

import { TIERS } from '@/scene/quality';
import { useAppStore } from '@/store/app';

/**
 * Post-processing for the Mellègue stage, tiered (docs/04 §7.3): high = Vignette + Noise + Bloom,
 * medium = Vignette, low = off. Bloom only catches HDR values (> 1), i.e. the radar beam/swath.
 * Not mounted during the intro: its shaders write display-referred colour straight to the canvas.
 */
export function Effects() {
  const quality = useAppStore((s) => s.quality);
  const reduced = useAppStore((s) => s.reducedMotion);
  if (quality === '2d') return null;
  const tier = TIERS[quality];
  if (!tier.vignette) return null;
  return (
    <EffectComposer multisampling={quality === 'high' ? 4 : 0}>
      {tier.bloom ? <Bloom mipmapBlur intensity={0.9} luminanceThreshold={1} luminanceSmoothing={0.05} /> : <></>}
      {tier.noise && !reduced ? <Noise premultiply blendFunction={BlendFunction.SOFT_LIGHT} opacity={0.22} /> : <></>}
      <Vignette offset={0.32} darkness={0.62} />
    </EffectComposer>
  );
}
