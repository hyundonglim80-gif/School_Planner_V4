// src/lib/clipboardHistory.ts
//
// 왼쪽 클립보드 칸에 보여 줄 '복사한 것' 목록.
//
// 어디서 모으나
//   1) 이 앱 안에서 Ctrl+C / 잘라내기 한 글자 (copy·cut 이벤트)
//   2) 다른 프로그램에서 복사하거나 캡처(Win+Shift+S 등)한 것 - 브라우저가 허락해야
//      읽을 수 있다(클립보드 읽기 권한). 칸의 '가져오기'를 한 번 누르면 크롬이 묻고,
//      허락해 두면 이 창으로 돌아올 때마다, 그리고 칸이 열려 있는 동안 스스로 가져온다.
//      (아이폰 사파리처럼 권한을 두지 않는 브라우저에서는 '가져오기'를 누를 때만 된다)
//
// 어디에 두나
//   이 기기의 브라우저(IndexedDB)에만 둔다. 계정에 올리지 않는다 - 클립보드에는
//   비밀번호 같은 것도 지나가므로 밖으로 보내지 않는다. 비밀번호 칸에서 한 복사는 모으지 않는다.
//   캡처 그림도 그대로 둘 수 있게 localStorage(5MB)가 아니라 IndexedDB를 쓴다.
//
// 붙여넣기
//   항목을 누르면 마지막으로 글을 쓰던 칸(입력칸·글상자)의 커서 자리에 넣는다.
//   그림은 그 칸에 Ctrl+V 한 것처럼 넘긴다(메모·기록 칸은 그림을 올려 붙인다).
//   받을 칸이 없으면 시스템 클립보드에 도로 담아 두고, 원하는 곳에서 Ctrl+V 하게 한다.
import { create } from 'zustand';

export interface ClipItem {
  id: string;
  kind: 'text' | 'image';
  text?: string;
  blob?: Blob;
  /** 같은 것을 두 번 담지 않으려고 쓰는 값 (글자는 글자 그대로, 그림은 내용의 해시) */
  key: string;
  createdAt: number;
}

/** 많이 쌓이면 오래된 것부터 버린다. 그림은 커서 따로 적게 둔다. */
export const MAX_ITEMS = 100;
export const MAX_IMAGES = 30;
/** 너무 긴 글자는 담지 않는다 (책 한 권을 복사한 경우 등) */
const MAX_TEXT = 200_000;

interface ClipState {
  items: ClipItem[];
  loaded: boolean;
}

export const useClipboardHistory = create<ClipState>(() => ({ items: [], loaded: false }));

// ── IndexedDB ──────────────────────────────────────────────
const DB_NAME = 'sp4-clipboard';
const STORE = 'items';
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function dbRun(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => void): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** 저장해 둔 목록을 읽는다. 처음 한 번만. */
export async function loadClipboardHistory(): Promise<void> {
  if (useClipboardHistory.getState().loaded) return;
  const db = await openDb();
  let items: ClipItem[] = [];
  if (db) {
    items = await new Promise<ClipItem[]>((resolve) => {
      try {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
        req.onsuccess = () => resolve((req.result as ClipItem[]) || []);
        req.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
  }
  // 읽는 사이에 새로 담긴 것이 있으면 합친다
  const current = useClipboardHistory.getState().items;
  const merged = [...current, ...items.filter((it) => !current.some((c) => c.key === it.key))];
  merged.sort((a, b) => b.createdAt - a.createdAt);
  useClipboardHistory.setState({ items: merged, loaded: true });
}

// ── 담기 ───────────────────────────────────────────────────
function newId() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function hashBlob(blob: Blob): Promise<string> {
  try {
    const buf = await blob.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return `${blob.type}:${blob.size}`;
  }
}

/** 새 항목을 맨 위에 둔다. 같은 것이 이미 있으면 그것을 맨 위로 올린다. 넘치면 오래된 것을 버린다. */
async function put(item: Omit<ClipItem, 'id' | 'createdAt'>): Promise<void> {
  const { items } = useClipboardHistory.getState();
  const existing = items.find((it) => it.key === item.key);
  // 이미 맨 위에 있는 것이면 할 일이 없다 (창으로 돌아올 때마다 같은 클립보드를 읽는다)
  if (existing && items[0] === existing) return;
  const entry: ClipItem = existing
    ? { ...existing, createdAt: Date.now() }
    : { ...item, id: newId(), createdAt: Date.now() };

  let next = [entry, ...items.filter((it) => it.key !== item.key)];
  const dropped: ClipItem[] = [];
  let images = 0;
  next = next.filter((it) => {
    if (it.kind === 'image' && ++images > MAX_IMAGES) {
      dropped.push(it);
      return false;
    }
    return true;
  });
  while (next.length > MAX_ITEMS) dropped.push(next.pop()!);

  useClipboardHistory.setState({ items: next });
  await dbRun('readwrite', (store) => {
    store.put(entry);
    dropped.forEach((it) => store.delete(it.id));
  });
}

export async function addClipText(text: string): Promise<void> {
  if (!text || !text.trim() || text.length > MAX_TEXT) return;
  await put({ kind: 'text', text, key: `t:${text}` });
}

export async function addClipImage(blob: Blob): Promise<void> {
  if (!blob || blob.size === 0) return;
  await put({ kind: 'image', blob, key: `i:${await hashBlob(blob)}` });
}

export async function removeClip(id: string): Promise<void> {
  useClipboardHistory.setState((s) => ({ items: s.items.filter((it) => it.id !== id) }));
  await dbRun('readwrite', (store) => store.delete(id));
}

export async function clearClips(): Promise<void> {
  useClipboardHistory.setState({ items: [] });
  await dbRun('readwrite', (store) => store.clear());
}

// ── 시스템 클립보드 읽기 ───────────────────────────────────
export type ReadResult = 'ok' | 'skipped' | 'denied' | 'unsupported';

/** 클립보드 읽기를 이미 허락해 두었나 (묻는 창을 띄우지 않고 알아본다) */
export async function clipboardReadGranted(): Promise<boolean> {
  try {
    const st = await navigator.permissions?.query({ name: 'clipboard-read' as PermissionName });
    return st?.state === 'granted';
  } catch {
    return false;
  }
}

/**
 * 시스템 클립보드를 읽어 목록에 담는다.
 * userAsked가 아니면(창으로 돌아올 때 등) 이미 허락된 경우에만 읽는다 - 묻는 창이 불쑥 뜨면 안 된다.
 */
export async function readSystemClipboard(userAsked: boolean): Promise<ReadResult> {
  const cb = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
  if (!cb || (!cb.read && !cb.readText)) return 'unsupported';
  if (!userAsked && !(await clipboardReadGranted())) return 'skipped';
  if (typeof document !== 'undefined' && !document.hasFocus()) return 'skipped';
  try {
    if (cb.read) {
      const clipItems = await cb.read();
      for (const ci of clipItems) {
        const imageType = ci.types.find((t) => t.startsWith('image/'));
        if (imageType) {
          await addClipImage(await ci.getType(imageType));
        } else if (ci.types.includes('text/plain')) {
          await addClipText(await (await ci.getType('text/plain')).text());
        }
      }
    } else {
      await addClipText(await cb.readText());
    }
    return 'ok';
  } catch {
    return 'denied';
  }
}

/** 항목을 시스템 클립보드에 도로 담는다 (받을 칸이 없을 때) */
export async function copyClipToSystem(item: ClipItem): Promise<boolean> {
  try {
    if (item.kind === 'text') {
      await navigator.clipboard.writeText(item.text || '');
    } else if (item.blob) {
      // 대부분의 브라우저는 PNG만 클립보드에 쓸 수 있다
      await navigator.clipboard.write([new ClipboardItem({ [item.blob.type || 'image/png']: item.blob })]);
    }
    return true;
  } catch {
    return false;
  }
}

// ── 붙여넣을 칸 기억 ───────────────────────────────────────
const TEXT_INPUT_TYPES = ['text', 'search', 'url', 'email', 'tel', 'number', ''];

export function isEditable(el: Element | null): el is HTMLElement {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement) {
    return TEXT_INPUT_TYPES.includes(el.type) && !el.readOnly && !el.disabled;
  }
  return el.isContentEditable;
}

let lastEditable: HTMLElement | null = null;

/** 마지막으로 글을 쓰던 칸. 클립보드 칸 안의 칸은 세지 않는다. */
export function rememberEditable(el: Element | null) {
  if (!isEditable(el)) return;
  if (el.closest('[data-clipboard-panel]')) return;
  lastEditable = el;
}

export function getPasteTarget(): HTMLElement | null {
  const active = document.activeElement;
  if (isEditable(active) && !active.closest('[data-clipboard-panel]')) return active;
  return lastEditable && lastEditable.isConnected ? lastEditable : null;
}

/** 글자를 칸의 커서 자리에 넣는다. React가 바뀐 값을 알도록 input 이벤트도 일으킨다. */
function insertText(el: HTMLElement, text: string) {
  el.focus();
  // execCommand는 되돌리기(Ctrl+Z)까지 살려 주고, React의 onChange도 제대로 부른다
  let done = false;
  try {
    done = document.execCommand('insertText', false, text);
  } catch {
    done = false;
  }
  if (done) return;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, start) + text + el.value.slice(end);
    // React가 값을 쥐고 있는 칸은 value를 그냥 바꾸면 무시한다. 원래 setter로 넣는다.
    const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, next);
    el.setSelectionRange(start + text.length, start + text.length);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    el.textContent = (el.textContent || '') + text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

export type PasteResult = 'pasted' | 'copied' | 'failed';

/**
 * 항목을 붙여넣는다. 받을 칸이 있으면 거기에, 없으면(또는 그림을 못 받는 칸이면)
 * 시스템 클립보드에 담아 두고 'copied'를 돌려준다.
 */
export async function pasteClip(item: ClipItem): Promise<PasteResult> {
  const target = getPasteTarget();
  if (target && item.kind === 'text') {
    insertText(target, item.text || '');
    return 'pasted';
  }
  if (target && item.kind === 'image' && item.blob) {
    target.focus();
    try {
      const ext = (item.blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
      const file = new File([item.blob], `clipboard.${ext}`, { type: item.blob.type || 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      target.dispatchEvent(ev);
      // 메모·기록 칸처럼 그림을 받는 칸은 붙여넣기를 가로채(preventDefault) 올린다
      if (ev.defaultPrevented) return 'pasted';
    } catch {
      /* 아래에서 클립보드에 담는다 */
    }
  }
  return (await copyClipToSystem(item)) ? 'copied' : 'failed';
}

/** 이 앱 안에서 복사(Ctrl+C)·잘라내기한 글자 */
export function selectedTextForCopy(): string {
  const active = document.activeElement;
  if (active instanceof HTMLInputElement && active.type === 'password') return '';
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    const { selectionStart: s, selectionEnd: e, value } = active;
    if (s != null && e != null && e > s) return value.slice(s, e);
  }
  return document.getSelection()?.toString() || '';
}
