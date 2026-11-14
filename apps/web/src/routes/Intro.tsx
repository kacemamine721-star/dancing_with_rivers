import { IntroExperience } from '@/features/intro';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

/**
 * `/` — the cinematic intro (prototype port, docs/05 §1). The 3D lives in the persistent Stage;
 * this route mounts the overlay. Debug: `/?t=<s>` freezes the intro, `/?dive=<s>` the dive,
 * `/?intro=1` forgets a remembered skip. Deep links (/story/:act…) never show the intro.
 */
export function Component() {
  useDocumentTitle();
  return <IntroExperience />;
}
