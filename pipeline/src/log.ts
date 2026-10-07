/* oxlint-disable no-console */
export const log = {
  step(message: string): void {
    console.log(`\n▸ ${message}`);
  },
  info(message: string): void {
    console.log(`  ${message}`);
  },
  warn(message: string): void {
    console.warn(`  ⚠ ${message}`);
  },
};
