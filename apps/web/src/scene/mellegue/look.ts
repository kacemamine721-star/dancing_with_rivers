import { Color, Vector3 } from 'three';

/** NW sun, azimuth 315°, elevation 28° (docs/04 §7.2), in scene axes (+x east, −z north). */
export const SUN_DIR = new Vector3(-Math.SQRT1_2 * Math.cos(0.49), Math.sin(0.49), -Math.SQRT1_2 * Math.cos(0.49));
export const HAZE_DAY = new Color('#1c2c3d');
export const HAZE_NIGHT = new Color('#060b16');
