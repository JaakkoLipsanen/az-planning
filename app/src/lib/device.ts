/** Touch-only devices (no hover), where taps replace hovering. */
export const TOUCH = typeof matchMedia === 'function' && matchMedia('(hover: none)').matches;

/** Phone-sized screens; matches the 820px breakpoint of the stylesheets. */
export function isNarrow(): boolean {
  return matchMedia('(max-width: 820px)').matches;
}
