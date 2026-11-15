import type { AppStore, StatePatch } from '@/store/app';

import type { ActAction, ActConfig } from './types';

/** The store slice the actions need (the real store, or a fake in tests). */
export type ActionTarget = Pick<
  AppStore,
  'setShot' | 'setDate' | 'setCompareDate' | 'setSwipe' | 'setLayer' | 'toggleLayer' | 'setFlood' | 'layers'
>;

/**
 * Apply one Try-it action. `navigate` actions are returned to the caller (the router lives in
 * the component), every other kind is a store write.
 */
export function applyAction(action: ActAction, store: ActionTarget, navigate?: (to: string) => void): void {
  switch (action.kind) {
    case 'shot':
      store.setShot(action.shot);
      return;
    case 'date':
      store.setDate(action.date);
      return;
    case 'compare':
      store.setCompareDate(action.date);
      if (action.swipe !== undefined) store.setSwipe(action.swipe);
      return;
    case 'swipe':
      store.setSwipe(action.value);
      return;
    case 'layer':
      if (action.on === undefined) store.toggleLayer(action.layer);
      else store.setLayer(action.layer, action.on);
      return;
    case 'flood':
      store.setFlood(action.flood);
      return;
    case 'navigate':
      navigate?.(action.to);
      return;
  }
}

export function applyActions(actions: ActAction[], store: ActionTarget, navigate?: (to: string) => void): void {
  for (const a of actions) applyAction(a, store, navigate);
}

/**
 * The state an act sets on entry. Layers are a complete record (the type requires every id), so
 * nothing stays on from the previous act; the swipe resets whenever the act compares two dates.
 */
export function actEntryPatch(config: ActConfig): StatePatch {
  const st = config.stage;
  return {
    mode: 'story',
    act: config.act,
    date: st.date,
    compareDate: st.compareDate,
    layers: { ...st.layers },
    ...(st.compareDate ? { swipe: st.swipe ?? 0.5 } : st.swipe !== undefined ? { swipe: st.swipe } : {}),
    ...(st.flood ? { flood: st.flood } : {}),
    floodPaused: false,
  };
}
