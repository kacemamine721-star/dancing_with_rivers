import { QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense, useLayoutEffect, useState } from 'react';
import { Outlet, ScrollRestoration, useLocation } from 'react-router-dom';

import { ErrorBoundary } from '@/app/ErrorBoundary';
import { createQueryClient } from '@/app/queryClient';
import { RouteFallback } from '@/app/RouteFallback';
import { TopBar } from '@/components/TopBar';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useAppStore } from '@/store/app';
import { useUrlSync } from '@/store/useUrlSync';

// three.js + R3F live in their own chunk, fetched in parallel with the UI (docs/03 §6.4).
const Stage = lazy(() => import('@/scene/Stage'));

function UrlSync() {
  useUrlSync();
  return null;
}

/**
 * Root layout (docs/04 §4): providers, the persistent <Stage/> mounted once OUTSIDE the outlet
 * (it survives route changes), the TopBar, and the routed content.
 */
export function AppShell() {
  const [queryClient] = useState(createQueryClient);
  const { pathname } = useLocation();
  const isIntro = pathname === '/';
  // The Stage shows on the intro and on the story / Dam Watch routes; docs pages hide (and pause) it.
  const stageVisible = isIntro || /^\/(story|watch)(\/|$)/.test(pathname);

  // Which world the Stage shows. Deep links land straight on the Mellègue terrain; the intro's
  // dive switches to it itself under the white flash before navigating.
  useLayoutEffect(() => {
    const s = useAppStore.getState();
    if (isIntro) s.setStageScene('intro');
    else if (stageVisible) s.setStageScene('mellegue');
  }, [isIntro, stageVisible]);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        <UrlSync />
        <a href="#main" className="skip-link">
          Skip to content
        </a>

        <div id="stage-root" className="pointer-events-none fixed inset-0 z-0 [&>*]:pointer-events-auto">
          <ErrorBoundary fallback={() => null}>
            <Suspense fallback={null}>
              <Stage active={stageVisible} />
            </Suspense>
          </ErrorBoundary>
        </div>

        {isIntro ? null : <TopBar />}

        <main id="main" tabIndex={-1} className="relative z-10 outline-none">
          <ErrorBoundary resetKey={pathname}>
            <Suspense fallback={<RouteFallback />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>

        <Toaster />
        <ScrollRestoration />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
