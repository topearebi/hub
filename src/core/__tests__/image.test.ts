import { describe, expect, it } from 'vitest';

import { computeScaledDimensions } from '../image';

describe('computeScaledDimensions', () => {
  it('downscales the longest edge to the max box', () => {
    expect(computeScaledDimensions(1024, 512, 256)).toEqual({ width: 256, height: 128 });
  });

  it('never upscales images smaller than the box', () => {
    expect(computeScaledDimensions(100, 50, 256)).toEqual({ width: 100, height: 50 });
  });

  it('preserves aspect ratio for portrait images', () => {
    expect(computeScaledDimensions(300, 600, 256)).toEqual({ width: 128, height: 256 });
  });

  it('returns zero dimensions for degenerate input', () => {
    expect(computeScaledDimensions(0, 100, 256)).toEqual({ width: 0, height: 0 });
    expect(computeScaledDimensions(100, 100, 0)).toEqual({ width: 0, height: 0 });
  });
});
