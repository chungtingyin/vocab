// Flash Card：設定頁與卡片頁

import { getTable, listRows, saveTable } from './db.js';
import { keyField } from './model.js';
import { allTags, renderValue, sortRows, stateFor } from './rows.js';
import { attachSwipe, go, h, icon, openDialog, toast, topbar } from './ui.js';

// 卡片頁重新整理後就沒有了，會回到設定頁重新開始
let session = null;

// 測驗紀錄的複習會用快照開啟卡片，不經過設定頁
export function startFlashSession(next) {
  session = next;
}

export function checkbox(label, checked, onchange) {
  return h('label', { class: 'check' },
    h('input', { type: 'checkbox', checked, onchange: (e) => onchange(e.target.checked) }),
    h('span', { class: 'check-box' }, icon('check', 14)),
    h('span', {}, label));
}

function defaultSettings(table) {
  const key = keyField(table.fields);
  return {
    front: [key.id],
    back: table.fields.filter((f) => !f.system && f !== key).map((f) => f.id),
    count: '',
    tags: [],
    order: 'random',
  };
}

// 欄位或標籤可能在上次使用後被刪除
function loadSettings(table, tags) {
  const settings = { ...defaultSettings(table), ...table.flashcard };
  const ids = new Set(table.fields.map((f) => f.id));
  settings.front = settings.front.filter((id) => ids.has(id));
  settings.back = settings.back.filter((id) => ids.has(id));
  settings.tags = settings.tags.filter((t) => tags.includes(t));
  return settings;
}

export function shuffle(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export async function pickTags(tags, selected) {
  const next = new Set(selected);
  const all = h('input', { type: 'checkbox', checked: next.size === 0 });
  const items = tags.map((t) => ({ tag: t, input: h('input', { type: 'checkbox', checked: next.has(t) }) }));
  const row = (input, label) => h('label', { class: 'check' }, input, h('span', { class: 'check-box' }, icon('check', 14)), h('span', {}, label));

  all.addEventListener('change', () => {
    all.checked = true; // 全部是預設狀態，勾選單一標籤才會取消
    next.clear();
    for (const item of items) item.input.checked = false;
  });
  for (const { tag, input } of items) {
    input.addEventListener('change', () => {
      if (input.checked) next.add(tag);
      else next.delete(tag);
      all.checked = next.size === 0;
    });
  }
  const ok = await openDialog({
    title: '選擇標籤',
    body: [h('div', { class: 'tag-options' }, row(all, '全部（含沒有標籤的資料）'), items.map((i) => row(i.input, i.tag)))],
    actions: [{ label: '取消', value: false }, { label: '確定', value: true, primary: true }],
  });
  return ok ? [...next] : null;
}

export async function flashcardSetupView(id) {
  const table = await getTable(id);
  if (!table) return null;
  document.title = `Flash Card - ${table.title}`;
  session = null;
  const back = `#/table/${id}`;
  const rows = await listRows(id);
  const tags = allTags(rows);
  const settings = loadSettings(table, tags);

  const matched = () => (settings.tags.length
    ? rows.filter((r) => r.tags?.some((t) => settings.tags.includes(t)))
    : rows);

  const panel = (title, key) => h('fieldset', { class: 'fc-panel' },
    h('legend', {}, title),
    table.fields.map((f) => checkbox(f.name, settings[key].includes(f.id), (on) => {
      settings[key] = on ? [...settings[key], f.id] : settings[key].filter((x) => x !== f.id);
    })));

  const countInput = h('input', {
    type: 'text',
    inputMode: 'numeric',
    class: 'input',
    id: 'fc-count',
    value: settings.count,
    placeholder: '全部',
    oninput: (e) => { settings.count = e.target.value.trim(); },
  });
  const available = h('p', { class: 'fc-available' });
  const tagLabel = h('span', {});
  const tagButton = h('button', {
    type: 'button',
    class: 'input fc-tag-btn',
    id: 'fc-tags',
    disabled: !tags.length,
    onclick: async () => {
      const next = await pickTags(tags, settings.tags);
      if (next) settings.tags = next;
      refresh();
    },
  }, tagLabel);
  const orderSelect = h('select', {
    class: 'input',
    'aria-label': '卡片順序',
    onchange: (e) => { settings.order = e.target.value; },
  },
  h('option', { value: 'sorted', selected: settings.order === 'sorted' }, '按照表格排序'),
  h('option', { value: 'random', selected: settings.order === 'random' }, '隨機'));
  const error = h('p', { class: 'error', hidden: true });

  function refresh() {
    if (!tags.length) tagLabel.textContent = '沒有標籤';
    else tagLabel.textContent = settings.tags.length ? settings.tags.join('、') : '全部標籤';
    available.textContent = `目前符合 ${matched().length} 張`;
  }
  refresh();

  function fail(message) {
    error.textContent = message;
    error.hidden = false;
  }

  async function start() {
    const front = table.fields.filter((f) => settings.front.includes(f.id));
    const backFields = table.fields.filter((f) => settings.back.includes(f.id));
    if (!front.length || !backFields.length) return fail('正面和背面都至少要選一個欄位');
    if (settings.count && (!/^\d+$/.test(settings.count) || Number(settings.count) < 1)) {
      return fail('卡片數量要是大於 0 的整數，留空代表全部');
    }
    const list = matched();
    if (!list.length) return fail(rows.length ? '沒有符合這些標籤的資料' : '這張表格還沒有資料');

    await saveTable({ ...table, flashcard: settings });
    const ordered = settings.order === 'sorted' ? sortRows(list, table, stateFor(id).sort) : shuffle(list);
    const wanted = settings.count ? Number(settings.count) : ordered.length;
    session = { tableId: id, title: table.title, front, back: backFields, cards: ordered.slice(0, wanted) };
    go(`#/table/${id}/flashcard/play`);
    if (wanted > ordered.length) toast(`只有 ${ordered.length} 張符合，全部顯示`);
    return undefined;
  }

  return h('div', { class: 'view' },
    topbar('Flash Card', () => go(back)),
    h('div', { class: 'scroll' },
      h('div', { class: 'form' },
        h('div', { class: 'fc-panels' }, panel('正面', 'front'), panel('背面', 'back')),
        h('div', { class: 'fc-options' },
          h('div', {},
            h('label', { class: 'fc-label', for: 'fc-count' }, '卡片數量'),
            countInput,
            available),
          h('div', {},
            h('label', { class: 'fc-label', for: 'fc-tags' }, '標籤'),
            tagButton)),
        error)),
    h('footer', { class: 'footer' },
      h('div', { class: 'fc-order' }, orderSelect),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: start }, 'START')));
}

function isEmpty(value) {
  return value === '' || (Array.isArray(value) && !value.length);
}

export function faceContent(fields, row) {
  const filled = fields.map((f) => ({ f, value: renderValue(f, row) })).filter((x) => !isEmpty(x.value));
  if (!filled.length) return h('p', { class: 'fc-empty' }, '（沒有內容）');
  return filled.map(({ f, value }, i) => {
    const length = typeof value === 'string' ? value.length : 0;
    const size = i > 0 ? 'fc-text' : length <= 8 ? 'fc-text fc-big' : length <= 24 ? 'fc-text fc-mid' : 'fc-text';
    return h('div', { class: 'fc-item' },
      filled.length > 1 ? h('p', { class: 'fc-name' }, f.name) : null,
      h('div', { class: size }, value));
  });
}

export async function flashcardPlayView(id) {
  if (session?.tableId !== id) {
    history.replaceState(null, '', `#/table/${id}/flashcard`);
    return flashcardSetupView(id);
  }
  const { cards, front, back, title } = session;
  const backHash = session.backHash ?? `#/table/${id}`;
  const backLabel = session.backLabel ?? '回到表格';
  document.title = `Flash Card - ${title}`;
  let index = 0;
  let flipped = false;

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const animate = (el, keyframes) => {
    if (!reduceMotion) el.animate(keyframes, { duration: 120, easing: 'steps(4)' });
  };

  const stage = h('div', { class: 'fc-stage' });
  const counter = h('span', { class: 'count' });
  const prev = h('button', { type: 'button', class: 'icon-btn boxed fc-arrow', 'aria-label': '上一張', onclick: () => move(-1) }, icon('back', 24));
  const next = h('button', { type: 'button', class: 'icon-btn boxed fc-arrow', 'aria-label': '下一張', onclick: () => move(1) }, icon('forward', 24));

  function move(step) {
    const target = index + step;
    if (target < 0 || target > cards.length) return;
    index = target;
    flipped = false;
    render();
    animate(stage.firstElementChild, [{ transform: `translateX(${step * 32}px)` }, { transform: 'none' }]);
  }

  function flip(card) {
    flipped = !flipped;
    renderFace(card);
    animate(card, [{ transform: 'scaleX(0)' }, { transform: 'none' }]);
  }

  function renderFace(card) {
    card.classList.toggle('back', flipped);
    card.replaceChildren(
      h('span', { class: 'fc-face' }, flipped ? '背面' : '正面'),
      h('div', { class: 'fc-content' }, faceContent(flipped ? back : front, cards[index])),
    );
  }

  function cardElement() {
    const card = h('div', { class: 'fc-card', role: 'button', tabIndex: 0, 'aria-label': '翻面' });
    attachSwipe(card, { onSwipe: move, onTap: () => flip(card) });
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        flip(card);
      }
    });
    renderFace(card);
    return card;
  }

  function finished() {
    return h('div', { class: 'fc-card fc-done' },
      h('p', { class: 'fc-big' }, '看完了'),
      h('p', {}, `共 ${cards.length} 張`),
      h('div', { class: 'fc-done-actions' },
        h('button', {
          type: 'button',
          class: 'btn',
          onclick: () => {
            index = 0;
            render();
          },
        }, '再看一次'),
        h('a', { class: 'btn btn-primary', href: backHash }, backLabel)));
  }

  function render() {
    const done = index === cards.length;
    stage.replaceChildren(done ? finished() : cardElement());
    counter.textContent = done ? `${cards.length} / ${cards.length}` : `${index + 1} / ${cards.length}`;
    prev.disabled = index === 0;
    next.disabled = done;
  }

  render();

  const view = h('div', { class: 'view' },
    topbar(title, () => go(backHash)),
    stage,
    h('footer', { class: 'footer' }, prev, counter, next));

  const onKey = (e) => {
    if (!view.isConnected) {
      removeEventListener('keydown', onKey);
      return;
    }
    if (e.key === 'ArrowLeft') move(-1);
    if (e.key === 'ArrowRight') move(1);
  };
  addEventListener('keydown', onKey);
  return view;
}
