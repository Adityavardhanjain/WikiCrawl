import { describe, expect, it } from 'vitest';
import { DENYLIST, isJunkTitle } from './filters';

describe('title filters', () => {
  it('rejects identifier titles and keeps year-only titles by default', () => {
    expect(isJunkTitle('Topic (identifier)')).toBe(true);
    expect(isJunkTitle('2019')).toBe(false);
    expect(isJunkTitle('2019', { rejectYearOnly: true })).toBe(true);
  });

  it('supports configurable denylist patterns', () => {
    DENYLIST.push(/^List of /i);
    try {
      expect(isJunkTitle('List of pages')).toBe(true);
    } finally {
      DENYLIST.pop();
    }
  });
});