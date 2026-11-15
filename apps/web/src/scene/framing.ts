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

export type Framing = Focus & {
  /** Zoom-out factor (>= 1) so the subject still fits when the free area is small. */
  zoom: number;
};

const overlaps = (a: Rect, b: Rect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/**
 * Where the shot's subject should land on screen (CSS px), given the viewport and the occluders,
 * and how much to zoom out so it fits. The subject is modelled as a box of the given `aspect`
 * (width / height) that fills ~55 % of the unobstructed screen height. Every empty rectangle
 * bounded by the screen and occluder edges is tried; the winner needs the least zoom-out (ties →
 * the larger area). So a square lake goes into the gap between the card and the widget column,
 * a long corridor into the band below them. `bias` nudges inside the free area ([-0.5, 0.5]).
 */
export function framing(
  w: number,
  h: number,
  occ: readonly Rect[],
  bias: Focus = { x: 0, y: 0 },
  aspect = 1.3,
): Framing {
  const screen: Rect = { left: 0, top: Math.min(TOPBAR_PX, h * 0.1), right: w, bottom: h };
  const sh = screen.bottom - screen.top;
  const subjH = 0.55 * sh;
  const subjW = Math.min(aspect * subjH, 0.85 * w);
  const need = (r: Rect) => Math.max(subjW / (0.92 * (r.right - r.left)), subjH / (0.92 * (r.bottom - r.top)));

  const hits = occ.filter((o) => overlaps(screen, o));
  const clampX = (x: number) => Math.max(screen.left, Math.min(screen.right, x));
  const clampY = (y: number) => Math.max(screen.top, Math.min(screen.bottom, y));
  const xs = [...new Set([screen.left, screen.right, ...hits.flatMap((o) => [o.left, o.right]).map(clampX)])].sort(
    (a, b) => a - b,
  );
  const ys = [...new Set([screen.top, screen.bottom, ...hits.flatMap((o) => [o.top, o.bottom]).map(clampY)])].sort(
    (a, b) => a - b,
  );
  let free = screen;
  let best = Infinity;
  let bestArea = 0;
  for (let a = 0; a < xs.length; a++)
    for (let b = a + 1; b < xs.length; b++)
      for (let c = 0; c < ys.length; c++)
        for (let d = c + 1; d < ys.length; d++) {
          const r: Rect = { left: xs[a]!, right: xs[b]!, top: ys[c]!, bottom: ys[d]! };
          const rw = r.right - r.left;
          const rh = r.bottom - r.top;
          if (rw < 40 || rh < 40 || hits.some((o) => overlaps(r, o))) continue;
          const z = need(r);
          const ar = rw * rh;
          if (z < best - 1e-3 || (Math.abs(z - best) <= 1e-3 && ar > bestArea)) {
            best = z;
            bestArea = ar;
            free = r;
          }
        }
  // on a narrow screen the sheet is full width: never shift sideways
  if (w < NARROW_PX) free = { ...free, left: 0, right: w };
  const fw = free.right - free.left;
  const fh = free.bottom - free.top;
  const zoom = Math.max(1, Math.min(1.8, need(free)));
  return { x: free.left + fw * (0.5 + bias.x), y: free.top + fh * (0.5 + bias.y), zoom };
}

/** Where the shot's subject should land on screen (CSS px). See `framing`. */
export function focusPoint(w: number, h: number, occ: readonly Rect[], bias: Focus = { x: 0, y: 0 }): Focus {
  const f = framing(w, h, occ, bias);
  return { x: f.x, y: f.y };
}
