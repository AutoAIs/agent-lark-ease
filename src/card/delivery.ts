import type { LarkChannel } from '@larksuite/channel';
import { log } from '../core/logger';
import {
  cardDeliveryCaps,
  splitCardForDelivery,
  splitCardText,
  type CardCaps,
} from './limits';
import { renderCard, type RunCardRenderOptions } from './run-renderer';
import type { RunState } from './run-state';
import { renderText } from './text-renderer';

export interface DeliverySendOpts {
  replyTo: string;
  replyInThread?: boolean;
}

export interface CardDeliveryInput {
  channel: LarkChannel;
  chatId: string;
  scope: string;
  state: RunState;
  sendOpts: DeliverySendOpts;
  cardRenderOptions: RunCardRenderOptions;
}

export interface SplitDeliveryProgress {
  readonly settled: Promise<unknown>;
  opened(): boolean;
  abandoned(): boolean;
  expired(): boolean;
}

export interface FinalDeliveryResult {
  action: 'none' | 'updated' | 'sent';
  segments: number;
  /** Present for a single segment: the caller may compare/update it. */
  card?: object;
}

const SETTLED_TIMEOUT_MS = 5000;
const CONTINUATION_DELAY_MS = 250;

function requireMessageReceipt(result: { messageId?: string } | undefined, type: string): void {
  if (!result?.messageId?.trim()) {
    throw new Error(`final ${type} reply missing message receipt`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function cardMetrics(card: object): Record<string, unknown> {
  const elements = ((card as { body?: { elements?: object[] } }).body?.elements ?? []) as Array<
    Record<string, unknown>
  >;
  let maxElemChars = 0;
  let tables = 0;
  let tools = 0;
  const walk = (list: object[]): void => {
    for (const element of list) {
      const el = element as Record<string, unknown>;
      const json = JSON.stringify(el);
      if (json.length > maxElemChars) maxElemChars = json.length;
      if (el.tag === 'markdown' && typeof el.content === 'string') {
        tables += (el.content.match(/^\s*\|.*\|\s*$/gm) ?? []).length;
      }
      if (el.tag === 'collapsible_panel') {
        const title = (el.header as { title?: { content?: string } } | undefined)?.title?.content;
        if (typeof title === 'string' && title.includes('工具调用')) tools += 1;
      }
      if (Array.isArray(el.elements)) walk(el.elements as object[]);
    }
  };
  walk(elements);
  const json = JSON.stringify(card);
  return {
    elems: elements.length,
    maxElemChars,
    totalChars: json.length,
    totalBytes: Buffer.byteLength(json),
    tables,
    tools,
  };
}

/**
 * Deliver the complete final answer as one or more standalone cards. Used for
 * Codex final replies, expired markdown streams, and any case where the
 * progress card cannot be trusted (stream failed / never opened).
 */
export async function sendCardSegments(input: CardDeliveryInput): Promise<void> {
  if (renderText(input.state).trim() === '') return;
  const card = renderCard(input.state, { ...input.cardRenderOptions, fullContent: true });
  const segments = splitCardForDelivery(card, cardDeliveryCaps());
  log.info('card', 'metrics', { scope: input.scope, ...cardMetrics(card) });
  const sizes = segments.map((segment) => JSON.stringify(segment).length);
  try {
    for (const [index, segment] of segments.entries()) {
      const opts =
        index === 0
          ? input.sendOpts
          : { ...(input.sendOpts.replyInThread ? { replyInThread: true } : {}) };
      const result = await input.channel.send(input.chatId, { card: segment }, opts);
      requireMessageReceipt(result, 'card');
      if (index < segments.length - 1) await sleep(CONTINUATION_DELAY_MS);
    }
    log.info('card', 'delivery', {
      scope: input.scope,
      outcome: 'sent',
      segments: segments.length,
      sizes,
    });
  } catch (err) {
    log.warn('card', 'delivery-failed', {
      scope: input.scope,
      segments: segments.length,
      err: err instanceof Error ? err.message : String(err),
    });
    await sendFinalTextFallback(input, err);
  }
}

/**
 * Last-resort text delivery when a card send/update fails. The SDK's markdown
 * sender chunks on line boundaries, which misses a single overlong line, so
 * split explicitly with the same fence-aware helper.
 */
export async function sendFinalTextFallback(
  input: CardDeliveryInput,
  reason: unknown,
): Promise<void> {
  const body = renderText(input.state);
  if (body.trim() === '') return;
  const chunks = splitCardText(body, 3000);
  try {
    for (const [index, chunk] of chunks.entries()) {
      const opts =
        index === 0
          ? input.sendOpts
          : { ...(input.sendOpts.replyInThread ? { replyInThread: true } : {}) };
      const result = await input.channel.send(input.chatId, { markdown: chunk }, opts);
      requireMessageReceipt(result, 'markdown');
      if (index < chunks.length - 1) await sleep(CONTINUATION_DELAY_MS);
    }
    log.info('card', 'delivery', {
      scope: input.scope,
      outcome: 'text-fallback',
      segments: chunks.length,
      reason: reason instanceof Error ? reason.message : String(reason),
    });
  } catch (err) {
    log.fail('card', err, {
      scope: input.scope,
      step: 'text-fallback',
      originalReason: reason instanceof Error ? reason.message : String(reason),
    });
  }
}

/**
 * Update the existing progress card with the first segment and send the rest as
 * new messages. A single segment is returned to the caller so it can compare
 * against what the stream already delivered and avoid a redundant update.
 */
export async function finalizeCardSplitDelivery(
  input: CardDeliveryInput & {
    progress: SplitDeliveryProgress;
    /** JSON of the last card the stream actually rendered, if known. */
    lastStreamedCardJson?: string;
  },
): Promise<FinalDeliveryResult> {
  const { progress } = input;
  if (!progress.opened() || progress.abandoned() || progress.expired()) {
    return { action: 'none', segments: 0 };
  }
  if (renderText(input.state).trim() === '') return { action: 'none', segments: 0 };

  const card = renderCard(input.state, { ...input.cardRenderOptions, fullContent: true });
  const segments = splitCardForDelivery(card, cardDeliveryCaps());
  log.info('card', 'metrics', { scope: input.scope, ...cardMetrics(card) });
  if (segments.length === 0) return { action: 'none', segments: 0 };

  // A single segment is usually already on screen from the terminal flush.
  // Only update when the full-content render differs from what was streamed.
  if (segments.length === 1) {
    const segment = segments[0]!;
    const segmentJson = JSON.stringify(segment);
    if (input.lastStreamedCardJson === segmentJson) {
      return { action: 'none', segments: 1, card: segment };
    }
    const settled = await settleWithTimeout(progress, input, 1);
    if (!settled) return { action: 'sent', segments: 1 };
    try {
      await input.channel.updateCard(settled, segment);
      log.info('card', 'delivery', { scope: input.scope, outcome: 'updated', segments: 1 });
      return { action: 'updated', segments: 1 };
    } catch (err) {
      log.warn('card', 'split-delivery-failed', {
        scope: input.scope,
        segments: 1,
        err: err instanceof Error ? err.message : String(err),
      });
      await sendFinalTextFallback(input, err);
      return { action: 'sent', segments: 1 };
    }
  }

  const sizes = segments.map((segment) => JSON.stringify(segment).length);
  const messageId = await settleWithTimeout(progress, input, segments.length);
  if (!messageId) return { action: 'sent', segments: segments.length };
  try {
    await input.channel.updateCard(messageId, segments[0]!);
    for (let index = 1; index < segments.length; index++) {
      const opts = input.sendOpts.replyInThread ? { replyInThread: true } : undefined;
      const result = await input.channel.send(input.chatId, { card: segments[index]! }, opts);
      requireMessageReceipt(result, 'card');
      if (index < segments.length - 1) await sleep(CONTINUATION_DELAY_MS);
    }
    log.info('card', 'delivery', {
      scope: input.scope,
      outcome: 'updated',
      segments: segments.length,
      sizes,
    });
    return { action: 'updated', segments: segments.length };
  } catch (err) {
    log.warn('card', 'split-delivery-failed', {
      scope: input.scope,
      segments: segments.length,
      err: err instanceof Error ? err.message : String(err),
    });
    await sendFinalTextFallback(input, err);
    return { action: 'sent', segments: segments.length };
  }
}

/**
 * Resolve the stream's messageId. If the stream never settles or the id is
 * missing, send the already-rendered segments as new messages instead of
 * blocking the run or updating an unknown message.
 */
async function settleWithTimeout(
  progress: SplitDeliveryProgress,
  input: CardDeliveryInput,
  segmentCount: number,
): Promise<string | undefined> {
  try {
    const settled = await withTimeout(progress.settled, SETTLED_TIMEOUT_MS, 'progress.settled');
    const id = (settled as { messageId?: string } | undefined)?.messageId;
    if (id) return id;
  } catch (err) {
    log.warn('card', 'settled-timeout', {
      scope: input.scope,
      segments: segmentCount,
      err: err instanceof Error ? err.message : String(err),
    });
  }
  await sendCardSegments(input);
  return undefined;
}

export function deliveryCaps(): CardCaps {
  return cardDeliveryCaps();
}
