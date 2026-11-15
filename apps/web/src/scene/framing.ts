/**
 * Framing around the story UI: the camera looks at the shot's subject, then a lens shift
 * (`camera.setViewOffset`) moves that subject into the free part of the screen, the area not
 * covered by the story card / bottom sheet. Recomputed on resize and when the card changes size.
 *
 * Occluders are found in the DOM: the act card (`section[aria-labelledby="act-title"]`) and any
 * element marked `data-stage-occluder` (UI panels can opt in). Pure functions here; CameraRig owns
 * the per-frame smoothing.
 */

export type Rect = { left: number; top: number; right: number; bottom: number };
export type Focus = { x: number; y: number };

const OCCLUDER_SELECTOR = 'section[aria-labelledby="act-title"], [data-stage-occluder]';
/** Below this width the card is a full-width sheet: only vertical shifting. */
export const NARROW_PX = 768;
const TOPBAR_PX = 62;

export function readOccluders(): Rect[] {
  if (typeof document === 'undefined') return [];
  const out: Rect[] = [];
  document.querySelectorAll<HTMLElement>(OCCLUDER_SELECTOR).forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width > 4 && r.height > 4) out.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  });
  return out;
}

/**
 * Where the shot's subject should land on screen (CSS px), given the viewport and the occluders.
 * `bias` nudges inside the free area ([-0.5, 0.5] of its size; e.g. y +0.1 = a little lower).
 */
export function focusPoint(w: number, h: number, occ: readonly Rect[], bias: Focus = { x: 0, y: 0 }): Focus {
  let free: Rect = { left: 0, top: Math.min(TOPBAR_PX, h * 0.1), right: w, bottom: h };
  for (const o of occ) {
    const ow = o.right - o.left;
    if (w >= NARROW_PX && ow < w * 0.6) {
      // a side column: keep the larger side
      const leftSpace = o.left - free.left;
      const rightSpace = free.right - o.right;
      if (rightSpace >= leftSpace) free = { ...free, left: Math.max(free.left, o.right) };
      else free = { ...free, right: Math.min(free.right, o.left) };
    } else {
      // a full-width sheet: keep the larger band above / below
      const above = o.top - free.top;
      const below = free.bottom - o.bottom;
      if (above >= below) free = { ...free, bottom: Math.min(free.bottom, o.top) };
      else free = { ...free, top: Math.max(free.top, o.bottom) };
    }
  }
  // never shrink to nothing (very small screens, giant cards): fall back to the screen
  if (free.right - free.left < w * 0.3 || free.bottom - free.top < h * 0.25) {
    free = { left: 0, top: free.top, right: w, bottom: Math.max(free.bottom, free.top + h * 0.25) };
  }
  const fw = free.right - free.left;
  const fh = free.bottom - free.top;
  return { x: free.left + fw * (0.5 + bias.x), y: free.top + fh * (0.5 + bias.y) };
}
