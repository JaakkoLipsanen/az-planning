import { describe, expect, it } from 'vitest';

import { fillGaps, mergeShortRuns } from './surface.ts';

/** Points every 50 m. */
const cumM = (n: number): Float64Array => Float64Array.from({ length: n }, (_, i) => i * 50);

describe('fillGaps', () => {
  it('bridges short unmatched stretches with the surrounding surface', () => {
    const matched = Int8Array.from([1, 1, -1, -1, 1, 1]);
    expect([...fillGaps(matched, new Uint8Array(6).fill(0), cumM(6))]).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it('uses the section default for long unmatched stretches between different surfaces', () => {
    const matched = Int8Array.from([1, ...Array<number>(10).fill(-1), 2]);
    const defaults = new Uint8Array(12).fill(0);
    expect([...fillGaps(matched, defaults, cumM(12))]).toEqual([1, ...Array<number>(10).fill(0), 2]);
  });
});

describe('mergeShortRuns', () => {
  it('merges a short run into its longer neighbour', () => {
    const surfaces = Uint8Array.from([0, 0, 0, 0, 0, 1, 2, 2, 2, 2, 2, 2, 2, 2]);
    expect(mergeShortRuns(surfaces, cumM(14))).toEqual([
      { start: 0, end: 4, surface: 0 },
      { start: 5, end: 13, surface: 2 },
    ]);
  });

  it('counts the stretch up to the next run when measuring a run', () => {
    const surfaces = Uint8Array.from([0, 0, 0, 0, 1, 2, 2, 2, 2]);
    const spacing = Float64Array.from([0, 50, 100, 150, 200, 1200, 1250, 1300, 1350]);
    expect(mergeShortRuns(surfaces, spacing).map((r) => r.surface)).toEqual([0, 1, 2]);
  });
});
