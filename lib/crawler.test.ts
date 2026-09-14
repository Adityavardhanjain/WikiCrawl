import test from 'node:test';
import assert from 'node:assert/strict';
import { getCrawlRequestBudget, shouldQueuePage } from './crawler.ts';

test('request budget clamps to a sane maximum and stays above the minimum', () => {
  assert.equal(getCrawlRequestBudget(50, 3), 500);
  assert.equal(getCrawlRequestBudget(500, 3), 500);
});

test('duplicate queue entries are rejected while new pages are allowed', () => {
  assert.equal(shouldQueuePage('Neural network', new Set(['neural network'])), false);
  assert.equal(shouldQueuePage('Quantum mechanics', new Set(['Complexity science'])), true);
});
