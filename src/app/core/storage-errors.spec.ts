import { describe, expect, it } from 'vitest';
import { storageAdvice, storageProblem } from './storage-errors';

describe('storage problems', () => {
  it('tell a full disk, a refusal and an interrupted write apart', () => {
    expect(storageProblem({ name: 'QuotaExceededError' })).toBe('quota');
    expect(storageProblem({ name: 'Error', code: 22 })).toBe('quota');
    expect(storageProblem({ name: 'SecurityError' })).toBe('denied');
    expect(storageProblem({ name: 'AbortError' })).toBe('interrupted');
    expect(storageProblem(new Error('x'))).toBe('other');
    expect(storageProblem(null)).toBe('other');
  });
  it('always point to a backup', () => {
    for (const p of ['quota', 'denied', 'interrupted', 'other'] as const) expect(storageAdvice(p)).toContain('Back up all');
  });
});
