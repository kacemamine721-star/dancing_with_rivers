import { useEffect } from 'react';

import { BRAND } from '@/brand';

/** Sets `<title>` to "<page> · <product>" (or the product · project on the home page). */
export function useDocumentTitle(page?: string): void {
  useEffect(() => {
    document.title = page ? `${page} · ${BRAND.product}` : `${BRAND.product} · ${BRAND.tagline}`;
  }, [page]);
}
