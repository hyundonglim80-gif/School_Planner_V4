import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  type HelpCategory,
  type HelpTopic,
  type HelpValues,
} from '../lib/helpTopics';

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** 지금 보고 있는 층: 첫 화면(기능별 분류) → 한 분류의 세부 기능 → 한 기능의 설명과 사용 예 */
type HelpView = { kind: 'home' } | { kind: 'category'; id: string } | { kind: 'topic'; id: string };

/** 그 층이 든 분류 (첫 화면은 없음) */
const categoryIdOf = (view: HelpView): string | null =>
  view.kind === 'category' ? view.id : view.kind === 'topic' ? findHelpTopic(view.id)?.category.id ?? null : null;

/**
 * 왼쪽 목차를 세울 만큼 넓은가 (설명서 칸의 폭 - 창이 아니라 칸이다).
 * 오른쪽 칸(기본 폭 약 500px)에서도 서고, 휴대폰 배너(약 390px)에서는 머리말의 📚 단추로 위에 펼친다.
 */
const TREE_MIN_WIDTH = 480;

/** 넓은 칸에서 목차를 접어 둔 것은 이 기기에 기억한다 (칸이 좁아 거추장스러우면 접어 둔다) */
const TREE_HIDDEN_KEY = 'sp4-help-tree-hidden';
function readTreeHidden(): boolean {
  try {
    return localStorage.getItem(TREE_HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}
function writeTreeHidden(hidden: boolean) {
  try {
    localStorage.setItem(TREE_HIDDEN_KEY, hidden ? '1' : '0');
  } catch {
    // 저장소를 못 쓰면(사생활 보호 창 등) 다음에 기억하지 못할 뿐이다
  }
}

/**
 * 사용 설명서.
 *
 * 첫 화면은 기능별 분류만 카드로 보여 준다. 분류를 누르면 그 안의 세부 기능 목록,
 * 기능을 누르면 세부 설명과 사용 예가 나온다. 예전에는 첫 화면에 기능 60개가
 * 한꺼번에 늘어서 있어 원하는 것을 찾으려면 길게 내려야 했다.
 * 왼쪽에는 분류 › 기능 목차(트리)가 늘 서 있어 어디서든 다른 기능으로 곧장 간다(2026-10-02 사용자 요청).
 * 지금 보는 분류는 펼쳐 두고 지금 기능은 짚는다. 칸이 좁으면(휴대폰) 머리말의 📚 목차 단추로 위에 펼친다.
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
  const [view, setView] = useState<HelpView>({ kind: 'home' });
  const topRef = useRef<HTMLElement>(null);

  // ── 왼쪽 목차 ──
  // 칸의 폭과 본문(스크롤 칸)의 높이를 잰다. 폭으로 목차를 옆에 세울지 정하고, 높이만큼 목차가 따로 스크롤된다.
  const boxRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef<HTMLElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = boxRef.current;
    const body = el?.parentElement;
    if (!el || !body) return;
    const measure = () =>
      setBox((prev) => (prev.w === el.clientWidth && prev.h === body.clientHeight ? prev : { w: el.clientWidth, h: body.clientHeight }));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(body);
    return () => ro.disconnect();
  }, [isOpen]);
  // 폭을 모를 때(그리기 전·시험 환경)는 넓은 것으로 본다
  const wide = !box.w || box.w >= TREE_MIN_WIDTH;
  /** 넓은 칸에서 목차를 접어 두었나 (이 기기에 기억) */
  const [treeHidden, setTreeHidden] = useState(readTreeHidden);
  /** 좁은 칸에서 목차를 위에 펼쳤나 */
  const [treeDropped, setTreeDropped] = useState(false);
  /** 목차에서 펼친 분류 */
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const showTree = wide ? !treeHidden : treeDropped;
  const currentCategoryId = categoryIdOf(view);

  const selected = view.kind === 'topic' ? findHelpTopic(view.id) : undefined;
  const openedCategory = view.kind === 'category' ? HELP_CATEGORIES.find((c) => c.id === view.id) : undefined;

  const go = (next: HelpView) => {
    setView(next);
    // 목차에서 지금 보는 분류를 펼쳐 둔다 (설명 안의 연결로 다른 분류에 가도 목차가 따라간다)
    const cid = categoryIdOf(next);
    if (cid) setExpanded((prev) => (prev.has(cid) ? prev : new Set(prev).add(cid)));
    // 좁은 칸에서 위에 펼친 목차는 고르면 접는다
    setTreeDropped(false);
    // 긴 목록 아래쪽에서 눌러도 새 내용의 처음부터 보이게 한다
    requestAnimationFrame(() => topRef.current?.scrollIntoView({ block: 'start' }));
  };

  // 목차에서 지금 항목이 보이게 목차만 굴린다 (scrollIntoView는 바깥 칸까지 움직여서 쓰지 않는다)
  useEffect(() => {
    const nav = treeRef.current;
    const item = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !item) return;
    const area = nav.getBoundingClientRect();
    const r = item.getBoundingClientRect();
    if (r.top < area.top) nav.scrollTop -= area.top - r.top + 8;
    else if (r.bottom > area.bottom) nav.scrollTop += r.bottom - area.bottom + 8;
  }, [view, showTree, expanded]);

  const toggleTree = () => {
    if (wide) {
      setTreeHidden(!treeHidden);
      writeTreeHidden(!treeHidden);
    } else {
      setTreeDropped(!treeDropped);
    }
  };
  const toggleCategory = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allExpanded = expanded.size === HELP_CATEGORIES.length;
  const openTopic = (id: string) => go({ kind: 'topic', id });
  const openCategory = (id: string) => go({ kind: 'category', id });
  const goHome = () => go({ kind: 'home' });

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
      data-help-topic={topic.id}
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
    // 이전·다음은 같은 분류 안에서만 오간다 (분류 끝에서 다른 분류로 넘어가면 어디 있는지 헷갈린다)
    const siblings = topic.category.topics;
    const index = siblings.findIndex((t) => t.id === topic.id);
    const prev = siblings[index - 1];
    const next = siblings[index + 1];
    const related = (topic.related || []).map(findHelpTopic).filter((t): t is NonNullable<typeof t> => !!t);

    return (
      <div className="space-y-4">
        {breadcrumb(topic.category, topic)}

        <div>
          <h3 className="text-base font-black text-slate-800 flex items-center gap-2">
            <span>{topic.icon}</span>
            <span>{topic.title}</span>
          </h3>
          <p className="text-slate-400 mt-0.5">{topic.summary}</p>
        </div>

        <section aria-labelledby="help-detail-heading" className="space-y-3">
          <h4 id="help-detail-heading" className="text-sm font-extrabold text-slate-800">
            📖 세부 설명
          </h4>
          {topic.blocks.map(renderBlock)}
        </section>

        <section aria-labelledby="help-example-heading" className="space-y-2.5">
          <h4 id="help-example-heading" className="text-sm font-extrabold text-slate-800">
            🧪 사용 예
          </h4>
          {topic.examples.map((ex, i) => (
            <div key={i} className="p-3 bg-emerald-50/60 border border-emerald-100 rounded-xl">
              <div className="font-bold text-emerald-900 mb-2">
                {topic.examples.length > 1 ? `예 ${i + 1}. ` : ''}
                {renderInline(ex.title)}
              </div>
              <ol className="space-y-1.5 text-slate-600">
                {ex.steps.map((step, j) => (
                  <li key={j} className="flex gap-2">
                    <span className="w-5 h-5 shrink-0 rounded-full bg-emerald-100 text-emerald-700 font-black flex items-center justify-center text-2xs mt-px">
                      {j + 1}
                    </span>
                    <span className="min-w-0">{renderInline(step)}</span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </section>

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

  // ── 왼쪽 목차 (분류 › 기능) ─────────────────────────────────────────
  // 제목은 자르지 않고 줄을 바꿔 다 보인다 (오른쪽 칸에서는 목차가 좁아 잘라 두면 '수업 · …'처럼 무엇인지 몰랐다)
  const treeRowClass = (active: boolean) =>
    `w-full min-w-0 text-left px-1.5 py-1 rounded-lg flex items-start gap-1.5 leading-snug break-keep transition-colors cursor-pointer ${
      active ? 'bg-primary/10 text-primary font-bold' : 'text-slate-600 hover:bg-white hover:text-primary'
    }`;

  const renderTree = () => (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between gap-1 px-2 pb-1">
        <span className="text-2xs font-black text-slate-500 tracking-wide">📚 목차</span>
        <button
          type="button"
          onClick={() => setExpanded(allExpanded ? new Set() : new Set(HELP_CATEGORIES.map((c) => c.id)))}
          className="text-2xs font-bold text-slate-400 hover:text-primary cursor-pointer"
        >
          {allExpanded ? '모두 접기' : '모두 펴기'}
        </button>
      </div>
      <button
        type="button"
        data-help-tree-home
        onClick={goHome}
        aria-current={view.kind === 'home' ? 'page' : undefined}
        className={treeRowClass(view.kind === 'home')}
      >
        <span className="shrink-0">🏠</span>
        <span className="min-w-0">처음 화면</span>
      </button>
      <button
        type="button"
        onClick={() => openTopic('shortcuts')}
        className={treeRowClass(false)}
      >
        <span className="shrink-0">⌨️</span>
        <span className="min-w-0">단축키 한눈에 보기</span>
      </button>
      <ul className="pt-1 space-y-0.5">
        {HELP_CATEGORIES.map((category) => {
          const open = expanded.has(category.id);
          const here = currentCategoryId === category.id;
          return (
            <li key={category.id}>
              <div className="flex items-start">
                <button
                  type="button"
                  onClick={() => toggleCategory(category.id)}
                  aria-expanded={open}
                  aria-label={`${category.title} ${open ? '접기' : '펴기'}`}
                  className="w-4 h-6 shrink-0 flex items-center justify-center rounded text-slate-400 hover:text-primary hover:bg-white cursor-pointer"
                >
                  {open ? '▾' : '▸'}
                </button>
                <button
                  type="button"
                  data-help-tree-category={category.id}
                  onClick={() => openCategory(category.id)}
                  aria-current={view.kind === 'category' && view.id === category.id ? 'page' : undefined}
                  title={category.summary}
                  className={`${treeRowClass(view.kind === 'category' && view.id === category.id)} flex-1 ${
                    here ? 'font-extrabold text-slate-800' : ''
                  }`}
                >
                  <span className="shrink-0">{category.icon}</span>
                  <span className="min-w-0">{category.title}</span>
                  <span className="ml-auto pl-1 shrink-0 text-2xs font-bold text-slate-400 leading-5">{category.topics.length}</span>
                </button>
              </div>
              {open && (
                <ul className="ml-2 pl-1.5 border-l border-slate-200 space-y-px py-0.5">
                  {category.topics.map((topic) => {
                    const active = view.kind === 'topic' && view.id === topic.id;
                    return (
                      <li key={topic.id}>
                        <button
                          type="button"
                          data-help-tree-topic={topic.id}
                          onClick={() => openTopic(topic.id)}
                          aria-current={active ? 'page' : undefined}
                          title={topic.title}
                          className={treeRowClass(active)}
                        >
                          <span className="shrink-0">{topic.icon}</span>
                          <span className="min-w-0">{topic.title}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );

  // ── 위치 표시 (사용 설명서 › 분류 › 기능) ─────────────────────────────
  function breadcrumb(category: HelpCategory, topic?: HelpTopic) {
    return (
      <nav aria-label="설명서 위치" className="flex items-center gap-1.5 flex-wrap text-slate-400">
        <button
          type="button"
          onClick={topic ? () => openCategory(category.id) : goHome}
          className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg font-bold transition-colors cursor-pointer"
        >
          ← {topic ? category.title : '기능별 분류'}
        </button>
        <button type="button" onClick={goHome} className="hover:text-primary hover:underline cursor-pointer">
          사용 설명서
        </button>
        <span>›</span>
        {topic ? (
          <button
            type="button"
            onClick={() => openCategory(category.id)}
            className="hover:text-primary hover:underline cursor-pointer"
          >
            {category.icon} {category.title}
          </button>
        ) : (
          <span className="text-slate-600 font-bold">
            {category.icon} {category.title}
          </span>
        )}
        {topic && (
          <>
            <span>›</span>
            <span className="text-slate-600 font-bold truncate">{topic.title}</span>
          </>
        )}
      </nav>
    );
  }

  // ── 첫 화면: 찾기 + 기능별 분류 ─────────────────────────────────────
  const renderHome = () => (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 -mx-5 -mt-4 px-5 pt-4 pb-2 bg-white">
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
          <section aria-labelledby="help-categories-heading">
            <h4 id="help-categories-heading" className="font-extrabold text-sm text-slate-800 mb-2">
              기능별 분류
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {HELP_CATEGORIES.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  data-help-category={category.id}
                  onClick={() => openCategory(category.id)}
                  className="w-full text-left px-3 py-3 bg-white hover:bg-blue-50/60 border border-slate-200/80 hover:border-primary/40 rounded-xl flex items-start gap-3 transition-colors cursor-pointer group"
                >
                  <span className="text-xl shrink-0 leading-none mt-0.5">{category.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="font-extrabold text-sm text-slate-800 group-hover:text-primary">
                        {category.title}
                      </span>
                      <span className="text-2xs font-bold text-slate-400">{category.topics.length}개 기능</span>
                    </span>
                    <span className="block text-slate-500 mt-0.5">{category.summary}</span>
                  </span>
                  <span className="text-slate-300 group-hover:text-primary shrink-0 self-center">›</span>
                </button>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );

  // ── 한 분류의 세부 기능 목록 ─────────────────────────────────────────
  const renderCategory = (category: HelpCategory) => (
    <div className="space-y-4">
      {breadcrumb(category)}
      <div>
        <h3 className="text-base font-black text-slate-800 flex items-center gap-2">
          <span>{category.icon}</span>
          <span>{category.title}</span>
        </h3>
        <p className="text-slate-400 mt-0.5">{category.summary}</p>
      </div>
      <div className="space-y-1.5">{category.topics.map((topic) => topicButton(topic))}</div>
    </div>
  );

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      // 가운데 팝업은 목차가 서 있을 때 그만큼 넓힌다 (오른쪽 칸·휴대폰 배너는 칸의 폭을 그대로 쓴다)
      width={wide && !treeHidden ? '4xl' : '2xl'}
      bare
      title="💡 School Planner V4 사용 설명서"
      headerExtra={
        <button
          type="button"
          data-help-tree-toggle
          onClick={toggleTree}
          aria-pressed={showTree}
          title={wide ? (treeHidden ? '왼쪽 목차 보이기' : '왼쪽 목차 접기') : treeDropped ? '목차 닫기' : '목차 열기'}
          className={`h-8 px-2.5 flex items-center gap-1 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
            showTree ? 'bg-primary/10 text-primary hover:bg-primary/20' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          📚 목차
        </button>
      }
      footer={<ModalCloseButton onClose={onClose} />}
    >
      <div ref={boxRef} className="@container flex items-start text-xs text-slate-700 leading-relaxed">
        {wide && showTree && (
          <nav
            ref={treeRef}
            aria-label="설명서 목차"
            data-help-tree
            className="sticky top-0 self-start shrink-0 w-44 @min-[640px]:w-56 overflow-y-auto overscroll-contain border-r border-slate-100 bg-slate-50/70 px-1 py-3"
            style={{ maxHeight: box.h || undefined }}
          >
            {renderTree()}
          </nav>
        )}
        <section aria-label="설명서 내용" ref={topRef} className="flex-1 min-w-0 px-5 py-4 scroll-mt-4">
          {!wide && showTree && (
            <nav
              ref={treeRef}
              aria-label="설명서 목차"
              data-help-tree
              className="mb-4 max-h-[55vh] overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-slate-50/70 px-1.5 py-2"
            >
              {renderTree()}
            </nav>
          )}
          {selected ? renderDetail(selected) : openedCategory ? renderCategory(openedCategory) : renderHome()}
        </section>
      </div>
    </ModalShell>
  );
}
