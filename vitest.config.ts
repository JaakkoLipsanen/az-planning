import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['{app/src,pipeline/src,shared}/**/*.test.ts'],
    environment: 'node',
  },
});
