import { describe, expect, it } from 'vitest';
import published from '../../../public/library/catalog.json';
import { sanitizeBlock } from '../core/blocks';
import { blockSize } from './block-size';

describe('block sizes in the Library', () => {
  const block = (id: string) => sanitizeBlock((published.blocks as { id: string }[]).find((b) => b.id === id))!;
  it('measures what a block places, in metres', () => {
    const gate = blockSize(block('abando/race-gate'))!;
    expect(gate.w).toBeGreaterThan(1);
    expect(gate.h).toBeGreaterThan(1);
    expect(blockSize(block('abando/small-warehouse'))!.h).toBeGreaterThan(3);
    expect(blockSize(block('abando/column-rows'))).toBeNull(); // a pattern has no size of its own
  });
  it('every catalogue block that is not a pattern gets a size', () => {
    for (const raw of published.blocks as { id: string; kind: string }[]) if (raw.kind !== 'pattern') expect(blockSize(sanitizeBlock(raw)!), raw.id).not.toBeNull();
  });
});
