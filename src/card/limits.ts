import { readBridgeEnv } from '../config/env-compat';
import { collapsiblePanel, markdown, noteMd } from './elements';

/**
 * Feishu card limits and the source-level hardening that keeps every streamed
 * patch inside them. The numbers mirror the todo VM's v4.1 patches, but the
 * enforcement lives here (renderer/delivery) instead of a patched SDK dist.
 */
export interface CardCaps {
  chars: number;
  bytes: number;
  elems: number;
}

const DEFAULT_TEXT_MAX_CHARS = 3500;
const DEFAULT_COMPACT_MAX_ELEMENTS = 45;
const DEFAULT_COMPACT_KEEP_TAIL = 30;
const DEFAULT_TABLE_KEEP = 2;
const DEFAULT_CAPS: CardCaps = { chars: 50_000, bytes: 65_000, elems: 46 };

function envInt(name: string, fallback: number): number {
  const raw = readBridgeEnv(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function cardTextMaxChars(): number {
  return envInt('CARD_TEXT_MAX_CHARS', DEFAULT_TEXT_MAX_CHARS);
}

export function cardCompactMaxElements(): number {
  return envInt('CARD_COMPACT_MAX_ELEMENTS', DEFAULT_COMPACT_MAX_ELEMENTS);
}

export function cardCompactKeepTail(): number {
  return envInt('CARD_COMPACT_KEEP_TAIL', DEFAULT_COMPACT_KEEP_TAIL);
}

export function cardTableKeep(): number {
  return envInt('CARD_TABLE_KEEP', DEFAULT_TABLE_KEEP);
}

export function cardDeliveryCaps(): CardCaps {
  return {
    chars: envInt('CARD_MAX_CHARS', DEFAULT_CAPS.chars),
    bytes: envInt('CARD_MAX_BYTES', DEFAULT_CAPS.bytes),
    elems: envInt('CARD_MAX_ELEMENTS', DEFAULT_CAPS.elems),
  };
}

/**
 * Split markdown into pieces whose length is <= `max`, preferring a newline
 * boundary. Code fences are closed at the end of a piece and reopened at the
 * start of the next, so each piece is independently valid markdown.
 *
 * Adapted from the SDK's splitWithCodeFences, with a hard split fallback for a
 * single line longer than the budget.
 */
export function splitCardText(text: string, max = cardTextMaxChars()): string[] {
  if (text.length <= max) return [text];
  const limit = Math.max(64, max - 8); // reserve room for a closing fence
  const lines = text.split('\n');
  const out: string[] = [];
  let buf: string[] = [];
  let bufLen = 0;
  let fenceLang: string | null = null;

  const flush = (): void => {
    if (buf.length === 0) return;
    let chunk = buf.join('\n');
    if (fenceLang !== null) chunk += '\n```';
    if (chunk.length > max) {
      for (let i = 0; i < chunk.length; i += max) out.push(chunk.slice(i, i + max));
    } else {
      out.push(chunk);
    }
    buf = [];
    bufLen = 0;
    if (fenceLang !== null) {
      buf.push(`\`\`\`${fenceLang}`);
      bufLen = buf[0]!.length;
    }
  };

  for (const rawLine of lines) {
    let line = rawLine;
    // A single line longer than the budget cannot be split on a newline.
    // Hard-split it; do not try to keep an open code fence across the cut
    // (such lines practically never occur inside fences).
    while (line.length > limit) {
      if (buf.length > 0) flush();
      out.push(line.slice(0, limit));
      line = line.slice(limit);
    }
    if (line.length === 0) {
      if (buf.length > 0) {
        buf.push('');
        bufLen += 1;
      }
      continue;
    }
    const lineLen = line.length + (buf.length > 0 ? 1 : 0);
    if (bufLen + lineLen > limit) flush();
    buf.push(line);
    bufLen += line.length + (buf.length > 1 ? 1 : 0);
    const m = line.match(/^```(\w*)$/);
    if (m) fenceLang = fenceLang === null ? m[1] || '' : null;
  }
  flush();
  return out.filter((piece) => piece.length > 0);
}

/**
 * Split every markdown element (including those nested in collapsible panels)
 * into pieces <= `max`, preserving element attributes such as text_size.
 */
export function splitTextInElements(
  elements: object[],
  max = cardTextMaxChars(),
): object[] {
  const splitOne = (element: object): object[] => {
    const el = element as Record<string, unknown>;
    if (el.tag === 'markdown' && typeof el.content === 'string') {
      const pieces = splitCardText(el.content, max);
      if (pieces.length <= 1) return [element];
      return pieces.map((piece) => ({ ...el, content: piece }));
    }
    if (el.tag === 'collapsible_panel' && Array.isArray(el.elements)) {
      return [{ ...el, elements: (el.elements as object[]).flatMap(splitOne) }];
    }
    return [element];
  };
  return elements.flatMap(splitOne);
}

/**
 * Structural compaction for progress cards: when there are more than
 * `maxKeep` elements, merge the early text, collapse the early tool panels
 * into a summary, and keep the tail (including the stop button/footer) intact.
 */
export function compactCardElements(
  elements: object[],
  maxKeep = cardCompactMaxElements(),
  keepTail = cardCompactKeepTail(),
): object[] {
  if (!Array.isArray(elements) || elements.length <= maxKeep) return elements;
  const tail = elements.slice(-keepTail);
  const head = elements.slice(0, elements.length - keepTail);
  const textParts: string[] = [];
  const histLines: string[] = [];
  for (const element of head) {
    const el = element as Record<string, unknown>;
    if (el.tag === 'markdown' && typeof el.content === 'string' && el.content) {
      textParts.push(el.content);
    } else if (el.tag === 'collapsible_panel') {
      const title = (el.header as { title?: { content?: unknown } } | undefined)?.title?.content;
      if (typeof title === 'string' && !title.includes('早期记录')) {
        histLines.push(`- ${title}`);
      }
    }
  }
  const out: object[] = [];
  const textAll = textParts.join('\n\n').trim();
  if (textAll) {
    for (const piece of splitCardText(textAll, cardTextMaxChars())) out.push(markdown(piece));
  }
  if (histLines.length > 0) {
    const title = '📦 **早期记录（已折叠）**';
    for (const piece of splitCardText(histLines.join('\n'), 3400)) {
      out.push(collapsiblePanel({ title, expanded: false, border: 'grey', body: piece }));
    }
  }
  out.push(...tail);
  return out;
}

interface TableBudget {
  left: number;
}

function demoteTableBlocks(md: string, budget: TableBudget): string {
  if (!md || !md.includes('|')) return md;
  const lines = md.split('\n');
  const out: string[] = [];
  let inFence = false;
  let block: string[] = [];
  const isSep = (line: string): boolean =>
    line.includes('|') && /-{3,}/.test(line) && /^[\s:|\-]+$/.test(line);
  const flush = (): void => {
    if (block.length === 0) return;
    const isTable = block.length >= 2 && block.some(isSep);
    if (!isTable) {
      out.push(...block);
    } else if (budget.left > 0) {
      budget.left -= 1;
      out.push(...block);
    } else {
      out.push('```', ...block, '```');
    }
    block = [];
  };
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      flush();
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      block.push(line);
      continue;
    }
    flush();
    out.push(line);
  }
  flush();
  return out.join('\n');
}

/**
 * Keep at most `keep` tables per card. Later tables are wrapped in a fenced
 * code block so the card still carries their content without tripping the
 * tenant's table-count limit (Feishu error 11310).
 */
export function demoteTablesInElements(elements: object[], keep = cardTableKeep()): object[] {
  const budget: TableBudget = { left: keep };
  const walk = (element: object): void => {
    const el = element as Record<string, unknown>;
    if (el.tag === 'markdown' && typeof el.content === 'string') {
      el.content = demoteTableBlocks(el.content, budget);
      return;
    }
    if (el.tag === 'collapsible_panel' && Array.isArray(el.elements)) {
      for (const inner of el.elements as object[]) walk(inner);
    }
  };
  for (const element of elements) walk(element);
  return elements;
}

interface CardLike {
  schema?: unknown;
  config?: Record<string, unknown>;
  body?: { elements?: object[] };
}

function cardSize(card: CardLike): { chars: number; bytes: number } {
  const json = JSON.stringify(card);
  return { chars: json.length, bytes: Buffer.byteLength(json) };
}

/**
 * Enforce the per-patch budget for streamed progress cards. When the card is
 * over the limit, drop the oldest elements (the tail, including the stop
 * button/footer, is preserved) and add a short omission notice.
 *
 * This replaces the VM's patchCard-SKIP guard: instead of skipping an
 * over-limit patch (leaving the card frozen), we send a smaller card that is
 * guaranteed to be accepted.
 */
export function fitCardToCaps(card: object, caps = cardDeliveryCaps()): object {
  const rec = card as CardLike;
  const original = Array.isArray(rec.body?.elements) ? rec.body!.elements! : [];
  let elements = [...original];
  let omitted = 0;
  const build = (els: object[]): object => ({
    ...rec,
    body: { ...(rec.body ?? {}), elements: els },
  });
  const noteFor = (count: number): object =>
    noteMd(`📦 早期内容已省略（${count} 项）；完整内容见日志或最终答案。`);
  const withNote = (els: object[], count: number): object[] =>
    count > 0 ? [noteFor(count), ...els] : els;
  const fits = (els: object[]): boolean => {
    const size = cardSize(build(els));
    return size.chars <= caps.chars && size.bytes <= caps.bytes && els.length <= caps.elems;
  };
  // Include the omission notice in the budget from the first removal, so the
  // final card can still explain why early content disappeared.
  while (elements.length > 1 && !fits(withNote(elements, omitted))) {
    elements.shift();
    omitted += 1;
  }
  if (omitted > 0) {
    const candidate = withNote(elements, omitted);
    if (fits(candidate)) elements = candidate;
  }
  return build(elements);
}

/**
 * Split a complete (fullContent) card into multiple standalone cards that each
 * respect the delivery caps. The first segment updates the progress card; the
 * rest are new messages.
 */
export function splitCardForDelivery(card: object, caps = cardDeliveryCaps()): object[] {
  const rec = card as CardLike;
  const elements = Array.isArray(rec.body?.elements) ? rec.body!.elements! : [];
  if (elements.length === 0) return [card];

  const config = { ...(rec.config ?? {}) };
  const skeleton = (index: number, count: number, els: object[]): object => {
    const nextConfig: Record<string, unknown> = {
      ...config,
      streaming_mode: false,
    };
    if (count > 1) {
      const base = (config.summary as { content?: string } | undefined)?.content ?? '';
      nextConfig.summary = { content: `${base}（${index + 1}/${count}）` };
    }
    const body: object[] = [];
    if (index > 0) {
      body.push({
        tag: 'markdown',
        content: `_（接上 · 第 ${index + 1}/${count} 段）_`,
        text_size: 'notation',
      });
    }
    body.push(...els);
    return { schema: rec.schema ?? '2.0', config: nextConfig, body: { elements: body } };
  };

  // Leave room for the continuation header and the per-segment summary, whose
  // size grows when the segment count crosses 9/10.
  const reserve = 320;
  const effective: CardCaps = {
    chars: Math.max(1000, caps.chars - reserve),
    bytes: Math.max(2000, caps.bytes - reserve),
    elems: caps.elems,
  };

  const groups: object[][] = [];
  let current: object[] = [];
  for (const element of elements) {
    const candidate = [...current, element];
    const size = cardSize({ body: { elements: candidate } });
    if (
      current.length > 0 &&
      (size.chars > effective.chars || size.bytes > effective.bytes || candidate.length > effective.elems)
    ) {
      groups.push(current);
      current = [element];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) groups.push(current);

  const count = groups.length;
  return groups.map((group, index) => skeleton(index, count, group));
}
