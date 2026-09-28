import { describe, it, expect } from 'vitest';
import { HELP_CATEGORIES, ALL_HELP_TOPICS, INLINE_TOKEN, topicText, type HelpBlock } from './helpTopics';
import { SHORTCUT_ACTIONS, formatActionBinding } from './shortcuts';
import helpSource from './helpTopics.ts?raw';

/** 한 항목 안의 모든 글 조각 */
const textsOf = (blocks: HelpBlock[]): string[] =>
  blocks.flatMap((b) => {
    switch (b.t) {
      case 'p':
      case 'h':
      case 'tip':
      case 'note':
        return [b.text];
      case 'ul':
      case 'ol':
        return b.items;
      case 'table':
        return [...b.head, ...b.rows.flat()];
      case 'shortcuts':
        return [];
    }
  });

const allTexts = ALL_HELP_TOPICS.flatMap((t) => [t.title, t.summary, ...textsOf(t.blocks)]);
const topicIds = new Set(ALL_HELP_TOPICS.map((t) => t.id));

describe('설명서 내용', () => {
  it('항목 id가 겹치지 않는다', () => {
    expect(topicIds.size).toBe(ALL_HELP_TOPICS.length);
  });

  it('갈래마다 항목이 있다', () => {
    for (const category of HELP_CATEGORIES) {
      expect(category.topics.length, category.title).toBeGreaterThan(0);
    }
  });

  it('다른 항목으로 가는 연결은 모두 있는 항목을 가리킨다', () => {
    const broken: string[] = [];
    for (const topic of ALL_HELP_TOPICS) {
      for (const id of topic.related || []) {
        if (!topicIds.has(id)) broken.push(`${topic.id} → related:${id}`);
      }
      for (const text of textsOf(topic.blocks)) {
        for (const m of text.matchAll(/\[\[([a-z0-9-]+)\|/g)) {
          if (!topicIds.has(m[1])) broken.push(`${topic.id} → [[${m[1]}]]`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it('단축키 자리표는 있는 기능만 가리킨다', () => {
    const ids = new Set(SHORTCUT_ACTIONS.map((a) => a.id));
    const unknown = allTexts
      .flatMap((text) => [...text.matchAll(/\{key:([A-Za-z]+)\}/g)].map((m) => m[1]))
      .filter((id) => !ids.has(id as any));
    expect(unknown).toEqual([]);
  });

  it('꾸밈 기호가 짝이 맞는다 (자리표로 풀리지 않은 기호가 남지 않는다)', () => {
    const leftovers = allTexts
      .map((text) => text.split(INLINE_TOKEN).filter((_, i) => i % 2 === 0).join(''))
      .filter((rest) => /\*\*|\{key:|\{lookback|\[\[|\]\]/.test(rest));
    expect(leftovers).toEqual([]);
  });

  // 바꿀 수 있는 단축키를 글로 적어 두면, 환경설정에서 바꾸는 순간 설명서가 틀린다
  it('바꿀 수 있는 단축키를 글로 적어 두지 않는다', () => {
    const written = SHORTCUT_ACTIONS.filter((a) => a.def.key)
      .map((a) => formatActionBinding(a, a.def))
      .flatMap((text) => (text.includes(' / ') ? [text, text.replace(' / ↓', '')] : [text]))
      .filter((text) => helpSource.includes(text));
    expect(written).toEqual([]);
  });

  it('이월 기간을 숫자로 적어 두지 않는다', () => {
    expect(helpSource).not.toMatch(/최근 \d+일|지난 \d+일/);
  });

  it('자리표가 실제 값으로 풀린다', () => {
    const topic = ALL_HELP_TOPICS.find((t) => t.id === 'forwarding')!;
    const text = topicText(topic, { keyOf: () => 'Alt + Q', lookback: 21 });
    expect(text).toContain('지난 21일');
    expect(text).toContain('Alt + Q');
    expect(text).not.toContain('{lookback}');
  });
});
