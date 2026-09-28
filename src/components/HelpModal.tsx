import React, { useMemo, useRef, useState } from 'react';
import ModalShell, { ModalCloseButton } from './ModalShell';
import { useAppStore } from '../store/useAppStore';
import {
  SHORTCUT_ACTIONS,
  FIXED_SHORTCUTS,
  resolveBindings,
  formatActionBinding,
  type ShortcutId,
} from '../lib/shortcuts';
import {
  HELP_CATEGORIES,
  ALL_HELP_TOPICS,
  INLINE_TOKEN,
  findHelpTopic,
  topicText,
  type HelpBlock,
  type HelpTopic,
  type HelpValues,
} from '../lib/helpTopics';

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * 사용 설명서.
 *
 * 기능 목록을 먼저 보여 주고, 하나를 누르면 그 기능의 자세한 설명으로 들어간다.
 * 내용은 lib/helpTopics.ts에 있고 여기서는 그리기만 한다.
 */
export default function HelpModal({ isOpen, onClose }: HelpModalProps) {
  // 안내 문구가 실제 동작과 어긋나지 않게 환경설정 값을 그대로 읽는다
  const forwardLookbackDays = useAppStore((s) => s.forwardLookbackDays);
  // 단축키도 마찬가지다. 여기 적어두면 환경설정에서 바꿨을 때 설명서가 거짓말을 한다.
  const shortcutOverrides = useAppStore((s) => s.shortcutOverrides);
  const bindings = resolveBindings(shortcutOverrides);

  const values: HelpValues = useMemo(() => {
    const current = resolveBindings(shortcutOverrides);
    return {
      keyOf: (id: ShortcutId) => {
        const action = SHORTCUT_ACTIONS.find((a) => a.id === id);
        return action ? formatActionBinding(action, current[id]) : '없음';
      },
      lookback: forwardLookbackDays,
    };
  }, [shortcutOverrides, forwardLookbackDays]);

  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const topRef = useRef<HTMLDivElement>(null);

  const selected = selectedId ? findHelpTopic(selectedId) : undefined;

  const openTopic = (id: string | null) => {
    setSelectedId(id);
    // 긴 목록 아래쪽에서 눌러도 새 내용의 처음부터 보이게 한다
    requestAnimationFrame(() => topRef.current?.scrollIntoView({ block: 'start' }));
  };

  // 찾기. 띄어 쓴 낱말이 모두 들어 있는 항목만 남긴다.
  const searchIndex = useMemo(
    () => ALL_HELP_TOPICS.map((topic) => ({ topic, text: topicText(topic, values).toLowerCase() })),
    [values]
  );
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  // 제목에 그 말이 든 항목을 앞에 세운다. 본문에만 스친 항목이 먼저 나오면
  // '링크'를 찾았는데 '하루 화면 구성'부터 보게 된다.
  const titleHits = (topic: HelpTopic) =>
    terms.filter((term) => `${topic.title} ${topic.summary}`.toLowerCase().includes(term)).length;
  const matches = terms.length
    ? searchIndex
        .filter(({ text }) => terms.every((term) => text.includes(term)))
        .map(({ topic }) => topic)
        .sort((a, b) => titleHits(b) - titleHits(a))
    : [];

  // ── 글 안의 꾸밈 ──────────────────────────────────────────────────
  const renderInline = (text: string): React.ReactNode[] =>
    text.split(INLINE_TOKEN).map((part, i) => {
      if (!part) return null;
      if (part.startsWith('**') && part.endsWith('**')) {
        return (
          <strong key={i} className="font-bold text-slate-800">
            {part.slice(2, -2)}
          </strong>
        );
      }
      const key = /^\{key:([A-Za-z]+)\}$/.exec(part);
      if (key) {
        return (
          <kbd
            key={i}
            className="px-1.5 py-px mx-0.5 bg-white border border-slate-300 rounded font-mono font-bold text-slate-700 shadow-2xs whitespace-nowrap"
          >
            {values.keyOf(key[1] as ShortcutId)}
          </kbd>
        );
      }
      if (part === '{lookback}') {
        return (
          <strong key={i} className="font-bold text-slate-800">
            {values.lookback}
          </strong>
        );
      }
      const link = /^\[\[([a-z0-9-]+)\|([^\]]+)\]\]$/.exec(part);
      if (link) {
        return (
          <button
            key={i}
            type="button"
            onClick={() => openTopic(link[1])}
            className="font-bold text-primary hover:underline cursor-pointer"
          >
            {link[2]}
          </button>
        );
      }
      return <React.Fragment key={i}>{part}</React.Fragment>;
    });

  // ── 내용 덩어리 ────────────────────────────────────────────────────
  const renderShortcutTable = () => {
    const groups = Array.from(new Set(SHORTCUT_ACTIONS.map((a) => a.group)));
    return (
      <div className="space-y-3">
        {groups.map((group) => (
          <div key={group}>
            <div className="text-xs font-bold text-slate-500 mb-1.5">{group}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {SHORTCUT_ACTIONS.filter((a) => a.group === group).map((action) => {
                const text = formatActionBinding(action, bindings[action.id]);
                return (
                  <div
                    key={action.id}
                    className="px-2.5 py-2 bg-slate-50 border border-slate-200/80 rounded-xl flex items-center justify-between gap-2"
                  >
                    <span className="text-slate-600 min-w-0">{action.label}</span>
                    <kbd
                      className={`px-2 py-0.5 shrink-0 bg-white border border-slate-300 rounded font-mono font-bold shadow-2xs ${
                        bindings[action.id].key ? '' : 'text-slate-300'
                      }`}
                    >
                      {text}
                    </kbd>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        <div>
          <div className="text-xs font-bold text-slate-500 mb-1.5">고정 (바꿀 수 없음)</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {FIXED_SHORTCUTS.map((fixed) => (
              <div
                key={fixed.label}
                className="px-2.5 py-2 bg-slate-50 border border-slate-200/80 rounded-xl flex items-center justify-between gap-2"
              >
                <span className="text-slate-600 min-w-0">{fixed.label}</span>
                <kbd className="px-2 py-0.5 shrink-0 bg-white border border-slate-300 rounded font-mono font-bold shadow-2xs">
                  {fixed.keys}
                </kbd>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderBlock = (block: HelpBlock, i: number) => {
    switch (block.t) {
      case 'p':
        return (
          <p key={i} className="text-slate-600">
            {renderInline(block.text)}
          </p>
        );
      case 'h':
        return (
          <h4 key={i} className="font-extrabold text-slate-800 pt-1">
            {renderInline(block.text)}
          </h4>
        );
      case 'ul':
        return (
          <ul key={i} className="list-disc pl-5 space-y-1.5 text-slate-600 marker:text-slate-300">
            {block.items.map((item, j) => (
              <li key={j}>{renderInline(item)}</li>
            ))}
          </ul>
        );
      case 'ol':
        return (
          <ol key={i} className="space-y-1.5 text-slate-600">
            {block.items.map((item, j) => (
              <li key={j} className="flex gap-2">
                <span className="w-5 h-5 shrink-0 rounded-full bg-primary/10 text-primary font-black flex items-center justify-center text-2xs mt-px">
                  {j + 1}
                </span>
                <span className="min-w-0">{renderInline(item)}</span>
              </li>
            ))}
          </ol>
        );
      case 'tip':
        return (
          <div key={i} className="p-3 bg-blue-50/70 border border-blue-100 rounded-xl text-slate-600 flex gap-2">
            <span className="shrink-0">💡</span>
            <p className="min-w-0">{renderInline(block.text)}</p>
          </div>
        );
      case 'note':
        return (
          <div key={i} className="p-3 bg-amber-50/70 border border-amber-100 rounded-xl text-slate-600 flex gap-2">
            <span className="shrink-0">⚠️</span>
            <p className="min-w-0">{renderInline(block.text)}</p>
          </div>
        );
      case 'table':
        return (
          <div key={i} className="border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-bold w-2/5">{block.head[0]}</th>
                  <th className="px-3 py-2 font-bold">{block.head[1]}</th>
                </tr>
              </thead>
              <tbody>
                {block.rows.map(([left, right], j) => (
                  <tr key={j} className="border-t border-slate-100 align-top">
                    <td className="px-3 py-2 font-bold text-slate-700">{renderInline(left)}</td>
                    <td className="px-3 py-2 text-slate-600">{renderInline(right)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case 'shortcuts':
        return <div key={i}>{renderShortcutTable()}</div>;
    }
  };

  // ── 목록의 한 줄 ───────────────────────────────────────────────────
  const topicButton = (topic: HelpTopic, categoryTitle?: string) => (
    <button
      key={topic.id}
      type="button"
      onClick={() => openTopic(topic.id)}
      className="w-full text-left px-3 py-2.5 bg-white hover:bg-blue-50/60 border border-slate-200/80 hover:border-primary/40 rounded-xl flex items-center gap-2.5 transition-colors cursor-pointer group"
    >
      <span className="text-base shrink-0">{topic.icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-bold text-slate-800 group-hover:text-primary truncate">{topic.title}</span>
        <span className="block text-slate-400 truncate">
          {categoryTitle ? `${categoryTitle} · ` : ''}
          {topic.summary}
        </span>
      </span>
      <span className="text-slate-300 group-hover:text-primary shrink-0">›</span>
    </button>
  );

  // ── 자세히 ─────────────────────────────────────────────────────────
  const renderDetail = (topic: NonNullable<typeof selected>) => {
    const index = ALL_HELP_TOPICS.findIndex((t) => t.id === topic.id);
    const prev = ALL_HELP_TOPICS[index - 1];
    const next = ALL_HELP_TOPICS[index + 1];
    const related = (topic.related || []).map(findHelpTopic).filter((t): t is NonNullable<typeof t> => !!t);

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => openTopic(null)}
            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg font-bold transition-colors cursor-pointer"
          >
            ← 목록
          </button>
          <span className="text-slate-400 truncate">
            {topic.category.icon} {topic.category.title}
          </span>
        </div>

        <div>
          <h3 className="text-base font-black text-slate-800 flex items-center gap-2">
            <span>{topic.icon}</span>
            <span>{topic.title}</span>
          </h3>
          <p className="text-slate-400 mt-0.5">{topic.summary}</p>
        </div>

        <div className="space-y-3">{topic.blocks.map(renderBlock)}</div>

        {related.length > 0 && (
          <div className="pt-3 border-t border-slate-100">
            <div className="font-bold text-slate-500 mb-1.5">함께 보면 좋은 항목</div>
            <div className="flex flex-wrap gap-1.5">
              {related.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => openTopic(t.id)}
                  className="px-2.5 py-1 bg-slate-50 hover:bg-blue-50 border border-slate-200 hover:border-primary/40 text-slate-600 hover:text-primary rounded-lg font-bold transition-colors cursor-pointer"
                >
                  {t.icon} {t.title}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-stretch justify-between gap-2 pt-3 border-t border-slate-100">
          {prev ? (
            <button
              type="button"
              onClick={() => openTopic(prev.id)}
              className="flex-1 min-w-0 text-left px-3 py-2 rounded-xl border border-slate-200 hover:border-primary/40 hover:bg-blue-50/50 transition-colors cursor-pointer"
            >
              <span className="block text-slate-400">‹ 이전</span>
              <span className="block font-bold text-slate-700 truncate">{prev.title}</span>
            </button>
          ) : (
            <span className="flex-1" />
          )}
          {next ? (
            <button
              type="button"
              onClick={() => openTopic(next.id)}
              className="flex-1 min-w-0 text-right px-3 py-2 rounded-xl border border-slate-200 hover:border-primary/40 hover:bg-blue-50/50 transition-colors cursor-pointer"
            >
              <span className="block text-slate-400">다음 ›</span>
              <span className="block font-bold text-slate-700 truncate">{next.title}</span>
            </button>
          ) : (
            <span className="flex-1" />
          )}
        </div>
      </div>
    );
  };

  // ── 목록 ───────────────────────────────────────────────────────────
  const renderList = () => (
    <div className="space-y-4">
      <div className="sticky -top-4 z-10 -mx-5 -mt-4 px-5 pt-4 pb-2 bg-white">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="기능 이름이나 궁금한 것으로 찾기 (예: 캡처, 이월, 링크)"
          aria-label="설명서에서 찾기"
          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary placeholder-slate-400"
        />
      </div>

      {terms.length > 0 ? (
        matches.length > 0 ? (
          <div className="space-y-1.5">
            <div className="text-slate-400">{matches.length}개 항목</div>
            {matches.map((topic) => topicButton(topic, topic.category.title))}
          </div>
        ) : (
          <p className="text-center text-slate-400 py-8">'{query.trim()}'에 대한 설명을 찾지 못했습니다.</p>
        )
      ) : (
        <>
          <button
            type="button"
            onClick={() => openTopic('shortcuts')}
            className="w-full px-3 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-bold flex items-center justify-between gap-2 transition-colors cursor-pointer"
          >
            <span>⌨️ 단축키 한눈에 보기</span>
            <span className="text-white/60 font-normal">지금 설정된 값 ›</span>
          </button>
          {HELP_CATEGORIES.map((category) => (
            <section key={category.id}>
              <h4 className="font-extrabold text-sm text-slate-800 flex items-center gap-1.5 mb-2">
                <span>{category.icon}</span> {category.title}
                <span className="text-xs font-bold text-slate-400">{category.topics.length}</span>
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {category.topics.map((topic) => topicButton(topic))}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  );

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      width="2xl"
      title="💡 School Planner V4 사용 설명서"
      footer={<ModalCloseButton onClose={onClose} />}
    >
      <div ref={topRef} className="scroll-mt-4 text-xs text-slate-700 leading-relaxed">
        {selected ? renderDetail(selected) : renderList()}
      </div>
    </ModalShell>
  );
}
