/** "Skip intro" is remembered across visits (docs/05 §1); storage may be blocked. */
export const SKIP_KEY = 'dwd.introSkipped';
export function rememberSkip(): void {
  try {
    localStorage.setItem(SKIP_KEY, '1');
  } catch {
    /* storage blocked */
  }
}
export function skipRemembered(): boolean {
  try {
    return localStorage.getItem(SKIP_KEY) === '1';
  } catch {
    return false;
  }
}
export function forgetSkip(): void {
  try {
    localStorage.removeItem(SKIP_KEY);
  } catch {
    /* storage blocked */
  }
}
