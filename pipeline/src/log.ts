/* oxlint-disable no-console */
export const log = {
  /** Warnings so far, for --strict. */
  warnings: 0,
  step(message: string): void {
    console.log(`\n▸ ${message}`);
  },
  info(message: string): void {
    console.log(`  ${message}`);
  },
  warn(message: string): void {
    this.warnings++;
    console.warn(`  ⚠ ${message}`);
  },
};
