import { create } from 'zustand';

/**
 * Scene-internal readiness (not app state, so it stays out of src/store): the loading veil reads it,
 * <MellegueScene> writes it once the terrain is decoded, uploaded and its program compiled.
 */
export type SceneStatus = {
  terrainReady: boolean;
  /** The terrain failed to load: the veil gives way and says so instead of spinning forever. */
  terrainError: boolean;
};

export const useSceneStatus = create<SceneStatus>()(() => ({ terrainReady: false, terrainError: false }));
