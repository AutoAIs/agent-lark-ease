import { describe, expect, it } from 'vitest';
import { collapsiblePanel, markdown } from '../../../src/card/elements';
import {
  compactCardElements,
  demoteTablesInElements,
  fitCardToCaps,
  splitCardForDelivery,
  splitCardText,
  splitTextInElements,
} from '../../../src/card/limits';

function fenceCount(text: string): number {
  return (text.match(/```/g) ?? []).length;
}

describe('splitCardText', () => {
  it('splits long text into pieces no longer than the limit', () => {
    const pieces = splitCardText('x'.repeat(1000), 200);
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) expect(piece.length).toBeLessThanOrEqual(200);
    expect(pieces.join('')).toBe('x'.repeat(1000));
  });

  it('closes and reopens code fences so every piece is valid markdown', () => {
    const text = '```ts\n' + Array.from({ length: 80 }, (_, i) => `const v${i} = ${i};`).join('\n') + '\n```';
    const pieces = splitCardText(text, 200);
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) {
      expect(piece.length).toBeLessThanOrEqual(200);
      expect(fenceCount(piece) % 2).toBe(0);
      expect(piece).toContain('```');
    }
  });

  it('handles text that starts with a fence', () => {
    const text = '```\n' + 'line\n'.repeat(200) + '```';
    for (const piece of splitCardText(text, 120)) {
      expect(piece.length).toBeLessThanOrEqual(120);
      expect(fenceCount(piece) % 2).toBe(0);
    }
  });

  it('keeps short text unchanged', () => {
    expect(splitCardText('short', 100)).toEqual(['short']);
  });
});

describe('splitTextInElements', () => {
  it('splits markdown inside collapsible panels and preserves text_size', () => {
    const panel = collapsiblePanel({
      title: 'panel',
      expanded: false,
      border: 'grey',
      body: 'y'.repeat(500),
    });
    const pieces = splitTextInElements([panel], 200);
    expect(pieces).toHaveLength(1);
    const elements = (pieces[0] as { elements: Array<Record<string, unknown>> }).elements;
    expect(elements.length).toBeGreaterThan(1);
    for (const element of elements) {
      expect(element.tag).toBe('markdown');
      expect(element.text_size).toBe('notation');
      expect(String(element.content).length).toBeLessThanOrEqual(200);
    }
  });
});

describe('compactCardElements', () => {
  it('merges early text, collapses early tools, and keeps the tail intact', () => {
    const elements = [
      markdown('first'),
      collapsiblePanel({ title: '✅ Bash — one', expanded: false, border: 'grey', body: 'a' }),
      markdown('second'),
      collapsiblePanel({ title: '✅ Read — two', expanded: false, border: 'grey', body: 'b' }),
      ...Array.from({ length: 40 }, (_, i) => markdown(`tail-${i}`)),
    ];
    const compacted = compactCardElements(elements, 10, 5);
    const json = JSON.stringify(compacted);
    expect(json).toContain('first');
    expect(json).toContain('second');
    expect(json).toContain('早期记录');
    expect(json).toContain('tail-39');
    expect(compacted.length).toBeLessThan(elements.length);
  });
});

describe('demoteTablesInElements', () => {
  const table = (name: string): string =>
    `| ${name} | value |\n| --- | --- |\n| a | 1 |`;

  it('keeps the first two tables and fences later ones', () => {
    const elements = [markdown([table('one'), table('two'), table('three')].join('\n\n'))];
    const result = demoteTablesInElements(elements, 2);
    const content = (result[0] as { content: string }).content;
    expect(content).toContain('| one |');
    expect(content).toContain('| two |');
    expect(content).toContain('```\n| three |');
  });

  it('does not touch tables already inside a fence', () => {
    const content = '```\n| inside | value |\n| --- | --- |\n| a | 1 |\n```';
    const result = demoteTablesInElements([markdown(content)], 0);
    expect((result[0] as { content: string }).content).toBe(content);
  });
});

describe('fitCardToCaps', () => {
  it('drops early elements and adds an omission notice', () => {
    const card = {
      schema: '2.0',
      config: { streaming_mode: true },
      body: {
        elements: Array.from({ length: 60 }, (_, i) => markdown(`element-${i} ${'x'.repeat(100)}`)),
      },
    };
    const fitted = fitCardToCaps(card, { chars: 3000, bytes: 6000, elems: 10 });
    const elements = (fitted as { body: { elements: object[] } }).body.elements;
    const json = JSON.stringify(fitted);
    expect(elements.length).toBeLessThanOrEqual(10);
    expect(json.length).toBeLessThanOrEqual(3000);
    expect(Buffer.byteLength(json)).toBeLessThanOrEqual(6000);
    expect(json).toContain('早期内容已省略');
    expect(json).toContain('element-59');
  });
});

describe('splitCardForDelivery', () => {
  it('splits a full card into standalone segments with numbering', () => {
    const card = {
      schema: '2.0',
      config: { streaming_mode: false, summary: { content: 'summary' } },
      body: {
        elements: Array.from({ length: 20 }, (_, i) => markdown(`part-${i} ${'z'.repeat(200)}`)),
      },
    };
    const segments = splitCardForDelivery(card, { chars: 2000, bytes: 4000, elems: 5 });
    expect(segments.length).toBeGreaterThan(1);
    for (const [index, segment] of segments.entries()) {
      const json = JSON.stringify(segment);
      expect(json.length).toBeLessThanOrEqual(2000);
      expect(Buffer.byteLength(json)).toBeLessThanOrEqual(4000);
      const config = (segment as { config: { streaming_mode: boolean; summary?: { content: string } } }).config;
      expect(config.streaming_mode).toBe(false);
      expect(config.summary?.content).toContain(`${index + 1}/${segments.length}`);
    }
    // Every original element survives exactly once across the segments.
    const all = JSON.stringify(segments);
    for (let i = 0; i < 20; i++) expect(all).toContain(`part-${i} `);
  });
});
