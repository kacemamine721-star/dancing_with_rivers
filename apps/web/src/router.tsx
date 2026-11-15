import { createBrowserRouter, type RouteObject } from 'react-router-dom';

import { AppShell } from '@/app/AppShell';
import { BootFallback } from '@/app/RouteFallback';
import { RouteError } from '@/routes/RouteError';

/** Routes (docs/04 §4). Every screen is a lazy chunk; the shell (and its Stage) is shared. */
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    errorElement: <RouteError />,
    HydrateFallback: BootFallback,
    children: [
      { index: true, lazy: () => import('@/routes/Intro') },
      { path: 'story/:act', lazy: () => import('@/routes/Story') },
      { path: 'story', lazy: () => import('@/routes/StoryIndex') },
      { path: 'watch', lazy: () => import('@/routes/Watch') },
      { path: 'watch/:damId', lazy: () => import('@/routes/Watch') },
      { path: 'methods', lazy: () => import('@/routes/Methods') },
      { path: 'sources', lazy: () => import('@/routes/Sources') },
      { path: 'school', lazy: () => import('@/routes/School') },
      { path: 'v2', lazy: () => import('@/routes/V2') },
      { path: '*', lazy: () => import('@/routes/NotFound') },
    ],
  },
];

export const ROUTER_FUTURE = {
  v7_relativeSplatPath: true,
  v7_fetcherPersist: true,
  v7_normalizeFormMethod: true,
  v7_partialHydration: true,
  v7_skipActionErrorRevalidation: true,
} as const;

export function createAppRouter() {
  return createBrowserRouter(routes, {
    basename: import.meta.env.BASE_URL.replace(/\/$/, '') || '/',
    future: ROUTER_FUTURE,
  });
}
