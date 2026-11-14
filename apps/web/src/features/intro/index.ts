/**
 * Cinematic intro (docs/05 §1): DOM overlay + shared runtime. The 3D part lives in
 * src/scene/intro (persistent Stage) and reads the same runtime.
 */
export { IntroExperience } from '@/features/intro/IntroExperience';
export { rememberSkip, skipRemembered } from '@/features/intro/skip';
export { intro } from '@/features/intro/runtime';
