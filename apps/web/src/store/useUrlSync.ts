import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import {
  type AppState,
  DEFAULT_LAYERS,
  DEFAULT_STATE,
  type DurationH,
  isAct,
  isLayerId,
  LAYER_IDS,
  type LayerId,
  type StatePatch,
  useAppStore,
  VOLUME_MAX_M3,
} from '@/store/app';

/**
 * URL ⇄ store mirroring (docs/04 §4, §9).
 *
 * Path carries the screen: `/story/:act`, `/watch/:damId`.
 * Query carries the view (defaults are omitted to keep links short):
 *   date=2026-07-01  layers=radar,mask  swipe=0.35  v=21 (Mm³)  mode=anuga  d=12  sc=v21_d12  lvl=experts
 */

export const URL_SYNC_DEBOUNCE_MS = 250;

/** Fields mirrored to the URL. */
export type UrlState = Pick<AppState, 'mode' | 'act' | 'date' | 'layers' | 'swipe' | 'flood' | 'level' | 'damId'>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAM_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const SCENARIO_ID = /^[a-z0-9][a-z0-9_.-]{0,63}$/i;
const DURATIONS: readonly DurationH[] = [6, 12, 24];

const round = (n: number, digits: number): number => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

const sameLayers = (a: Record<LayerId, boolean>, b: Record<LayerId, boolean>): boolean =>
  LAYER_IDS.every((id) => a[id] === b[id]);

/** Build the pathname for a state, or `null` when the path is not owned by the store (intro, docs pages). */
export function pathForState(s: Pick<UrlState, 'mode' | 'act' | 'damId'>, currentPath: string): string | null {
  if (s.mode === 'story') return `/story/${s.act}`;
  if (s.mode === 'watch')
    return currentPath === '/watch' && s.damId === DEFAULT_STATE.damId ? '/watch' : `/watch/${s.damId}`;
  return null;
}

/** Serialise the URL-mirrored state to a query string (without "?"), omitting defaults. */
export function serializeQuery(s: UrlState): string {
  const q = new URLSearchParams();
  if (s.date !== DEFAULT_STATE.date) q.set('date', s.date);
  if (!sameLayers(s.layers, DEFAULT_LAYERS)) {
    q.set('layers', LAYER_IDS.filter((id) => s.layers[id]).join(','));
  }
  if (round(s.swipe, 3) !== DEFAULT_STATE.swipe) q.set('swipe', String(round(s.swipe, 3)));
  if (s.flood.volumeM3 !== DEFAULT_STATE.flood.volumeM3) q.set('v', String(round(s.flood.volumeM3 / 1e6, 3)));
  if (s.flood.mode !== DEFAULT_STATE.flood.mode) q.set('mode', s.flood.mode);
  if (s.flood.durationH !== DEFAULT_STATE.flood.durationH) q.set('d', String(s.flood.durationH));
  if (s.flood.scenarioId) q.set('sc', s.flood.scenarioId);
  if (s.level !== DEFAULT_STATE.level) q.set('lvl', s.level);
  // URLSearchParams encodes "," as %2C; keep layer lists readable.
  return q.toString().replace(/%2C/g, ',');
}

/** Parse a pathname + query into a store patch. Invalid values are ignored, never thrown. */
export function parseUrl(pathname: string, search: string): StatePatch {
  const patch: StatePatch = {};
  const parts = pathname.split('/').filter(Boolean);

  if (parts.length === 0) patch.mode = 'intro';
  else if (parts[0] === 'story') {
    patch.mode = 'story';
    const n = Number(parts[1]);
    if (parts[1] !== undefined && isAct(n)) patch.act = n;
  } else if (parts[0] === 'watch') {
    patch.mode = 'watch';
    const dam = parts[1] ? decodeURIComponent(parts[1]) : undefined;
    if (dam && DAM_ID.test(dam)) patch.damId = dam;
  }

  const q = new URLSearchParams(search);

  const date = q.get('date');
  if (date && ISO_DATE.test(date) && !Number.isNaN(Date.parse(date))) patch.date = date;

  const layers = q.get('layers');
  if (layers !== null) {
    const on = new Set(
      layers
        .split(',')
        .map((x) => x.trim())
        .filter(isLayerId),
    );
    patch.layers = Object.fromEntries(LAYER_IDS.map((id) => [id, on.has(id)])) as Record<LayerId, boolean>;
  }

  const swipe = q.get('swipe');
  if (swipe !== null && swipe.trim() !== '') {
    const n = Number(swipe);
    if (Number.isFinite(n)) patch.swipe = Math.min(1, Math.max(0, n));
  }

  const flood: NonNullable<StatePatch['flood']> = {};
  const v = q.get('v');
  if (v !== null && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) flood.volumeM3 = Math.min(VOLUME_MAX_M3, Math.max(0, round(n * 1e6, 0)));
  }
  const mode = q.get('mode');
  if (mode === 'hand' || mode === 'anuga') flood.mode = mode;
  const d = Number(q.get('d'));
  if (DURATIONS.includes(d as DurationH)) flood.durationH = d as DurationH;
  const sc = q.get('sc');
  if (sc && SCENARIO_ID.test(sc)) flood.scenarioId = sc;
  if (Object.keys(flood).length > 0) patch.flood = flood;

  const lvl = q.get('lvl');
  if (lvl === 'everyone' || lvl === 'experts') patch.level = lvl;

  return patch;
}

/** Full URL (path + query) for a state, given the current pathname. */
export function urlForState(s: UrlState, currentPath: string): string {
  const path = pathForState(s, currentPath) ?? currentPath;
  const query = serializeQuery(s);
  return query ? `${path}?${query}` : path;
}

const pick = (s: AppState): UrlState => ({
  mode: s.mode,
  act: s.act,
  date: s.date,
  layers: s.layers,
  swipe: s.swipe,
  flood: s.flood,
  level: s.level,
  damId: s.damId,
});

/**
 * Mount once under the router (AppShell). Hydrates the store from the URL on load and on every
 * navigation, then mirrors store changes back with a debounced `replaceState` (query) or a
 * router `navigate(…, { replace: true })` when the path itself must change.
 */
export function useUrlSync(debounceMs: number = URL_SYNC_DEBOUNCE_MS): void {
  const location = useLocation();
  const navigate = useNavigate();
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;

  // URL → store (load + navigation). Only routes the store owns hydrate it.
  useEffect(() => {
    const owned = location.pathname === '/' || /^\/(story|watch)(\/|$)/.test(location.pathname);
    if (!owned) return;
    useAppStore.getState().hydrate(parseUrl(location.pathname, location.search));
  }, [location.pathname, location.search]);

  // store → URL (debounced).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      const current = pathRef.current;
      if (!/^\/(story|watch)(\/|$)/.test(current)) return; // intro and docs pages keep their URL
      const next = urlForState(pick(useAppStore.getState()), current);
      const [nextPath] = next.split('?');
      const now = window.location.pathname + window.location.search;
      if (next === now) return;
      if (nextPath !== current) navigate(next, { replace: true });
      else window.history.replaceState(window.history.state, '', next + window.location.hash);
    };
    const unsubscribe = useAppStore.subscribe((s, prev) => {
      const a = pick(s);
      const b = pick(prev);
      if (
        a.mode === b.mode &&
        a.act === b.act &&
        a.date === b.date &&
        a.layers === b.layers &&
        a.swipe === b.swipe &&
        a.flood === b.flood &&
        a.level === b.level &&
        a.damId === b.damId
      ) {
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(flush, debounceMs);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [navigate, debounceMs]);
}
