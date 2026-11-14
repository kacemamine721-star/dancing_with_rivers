import { act, render } from '@testing-library/react';
import { type Location, MemoryRouter, useLocation, useNavigationType } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type AppState, DEFAULT_LAYERS, DEFAULT_STATE, initialState, useAppStore } from '@/store/app';
import { parseUrl, serializeQuery, urlForState, type UrlState, useUrlSync } from '@/store/useUrlSync';

const base = (): UrlState => {
  const s = initialState();
  return {
    mode: 'story',
    act: s.act,
    date: s.date,
    layers: s.layers,
    swipe: s.swipe,
    flood: s.flood,
    level: 'everyone',
    damId: s.damId,
  };
};

/** Apply a parsed URL to a fresh default state, the way a cold deep link does. */
function roundTrip(s: UrlState): UrlState {
  const url = new URL(urlForState(s, '/story/1'), 'https://example.test');
  const p = parseUrl(url.pathname, url.search);
  const d = base();
  return {
    mode: p.mode ?? d.mode,
    act: p.act ?? d.act,
    date: p.date ?? d.date,
    layers: { ...d.layers, ...p.layers },
    swipe: p.swipe ?? d.swipe,
    flood: { ...d.flood, ...p.flood },
    level: p.level ?? d.level,
    damId: p.damId ?? d.damId,
  };
}

describe('URL serialisation', () => {
  it('omits defaults (clean share links)', () => {
    expect(serializeQuery(base())).toBe('');
    expect(urlForState(base(), '/story/1')).toBe('/story/1');
  });

  it('round-trips every mirrored field (story)', () => {
    const s: UrlState = {
      ...base(),
      act: 3,
      date: '2026-07-01',
      layers: { ...DEFAULT_LAYERS, basemap: false, mask: true, change: true },
      swipe: 0.35,
      flood: { mode: 'anuga', volumeM3: 195e6, durationH: 24, scenarioId: 'v195_d24' },
      level: 'experts',
    };
    expect(urlForState(s, '/story/1')).toBe(
      '/story/3?date=2026-07-01&layers=radar,mask,change&swipe=0.35&v=195&mode=anuga&d=24&sc=v195_d24&lvl=experts',
    );
    expect(roundTrip(s)).toEqual(s);
  });

  it('round-trips the dam id (watch)', () => {
    const s: UrlState = { ...base(), mode: 'watch', damId: 'sidi_salem' };
    expect(urlForState(s, '/watch')).toBe('/watch/sidi_salem');
    expect(roundTrip(s)).toEqual(s);
  });

  it('parses the documented example deep link', () => {
    expect(parseUrl('/story/3', '?date=2026-06-19&layers=radar,mask&swipe=0.5&v=21&mode=hand&lvl=experts')).toEqual({
      mode: 'story',
      act: 3,
      date: '2026-06-19',
      layers: { ...Object.fromEntries(Object.keys(DEFAULT_LAYERS).map((k) => [k, false])), radar: true, mask: true },
      swipe: 0.5,
      flood: { volumeM3: 21e6, mode: 'hand' },
      level: 'experts',
    });
  });

  it('ignores invalid values instead of throwing', () => {
    expect(parseUrl('/story/12', '?date=yesterday&swipe=abc&v=-5&mode=nope&d=7&lvl=gods&layers=radar,bogus')).toEqual({
      mode: 'story',
      layers: { ...Object.fromEntries(Object.keys(DEFAULT_LAYERS).map((k) => [k, false])), radar: true },
      flood: { volumeM3: 0 },
    });
    expect(parseUrl('/story/1', '?swipe=4').swipe).toBe(1);
    expect(parseUrl('/watch/..%2F..', '').damId).toBeUndefined();
  });
});

// A plain MemoryRouter: jsdom's AbortSignal is rejected by Node's Request in data routers.
const seen: { location: Location | null; action: string | null } = { location: null, action: null };

function Harness() {
  useUrlSync(50);
  seen.location = useLocation();
  seen.action = useNavigationType();
  return null;
}

function mount(initial: string) {
  render(
    <MemoryRouter initialEntries={[initial]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Harness />
    </MemoryRouter>,
  );
  return {
    get pathname() {
      return seen.location?.pathname;
    },
    get action() {
      return seen.action;
    },
  };
}

describe('useUrlSync()', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useAppStore.getState().reset();
    window.history.replaceState(null, '', '/');
  });
  afterEach(() => vi.useRealTimers());

  it('hydrates the store from a deep link on load', () => {
    mount('/story/4?date=2026-07-13&lvl=experts&v=50');
    const s: AppState = useAppStore.getState();
    expect(s.mode).toBe('story');
    expect(s.act).toBe(4);
    expect(s.date).toBe('2026-07-13');
    expect(s.level).toBe('experts');
    expect(s.flood.volumeM3).toBe(50e6);
    expect(s.swipe).toBe(DEFAULT_STATE.swipe);
  });

  it('mirrors store changes to the URL with one debounced replaceState', () => {
    const router = mount('/story/2');
    window.history.replaceState(null, '', '/story/2');
    const spy = vi.spyOn(window.history, 'replaceState');

    act(() => {
      useAppStore.getState().setSwipe(0.2);
      useAppStore.getState().setDate('2026-07-03');
      useAppStore.getState().setLayer('mask', true);
    });
    expect(spy).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(60));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(window.location.pathname + window.location.search).toBe(
      '/story/2?date=2026-07-03&layers=basemap,radar,mask&swipe=0.2',
    );
    expect(router.pathname).toBe('/story/2');
  });

  it('navigates (replace) when the act changes the path', () => {
    const router = mount('/story/2');
    act(() => useAppStore.getState().setAct(5));
    act(() => vi.advanceTimersByTime(60));
    expect(router.pathname).toBe('/story/5');
    expect(router.action).toBe('REPLACE');
  });
});
