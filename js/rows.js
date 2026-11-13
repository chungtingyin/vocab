// 主畫面（表格）與新增／編輯頁

import { addRows, deleteRows, getRow, getTable, listRows, putRows } from './db.js';
import { coerceValue, fieldText, fieldValue, formatDate, keyField, keyOf, normalizeText, parseTags } from './model.js';
import { parseRows, readJsonFile } from './transfer.js';
import { confirmDialog, go, h, icon, openDialog, pickFile, toast, topbar } from './ui.js';

const DEFAULT_SORT = { fieldId: 'createdAt', dir: 'desc' };
// 從新增頁回來時，保留搜尋、篩選和排序
const viewStates = new Map();

export function stateFor(id) {
  if (!viewStates.has(id)) viewStates.set(id, { query: '', tag: '', sort: { ...DEFAULT_SORT } });
  return viewStates.get(id);
}

export function allTags(rows) {
  return [...new Set(rows.flatMap((r) => r.tags ?? []))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export function renderValue(f, row) {
  const value = fieldValue(f, row);
  if (f.type === 'tags') return value.map((t) => h('span', { class: 'tag' }, t));
  if (f.type === 'createdAt') return formatDate(value);
  return String(value);
}

function sortKey(f, row) {
  const value = fieldValue(f, row);
  if (f.type === 'tags') return value.join(' ');
  if (f.type === 'number') {
    const n = value === '' ? NaN : Number(value);
    return Number.isNaN(n) ? '' : n;
  }
  return value;
}

export function sortRows(rows, table, sort) {
  const f = table.fields.find((x) => x.id === sort.fieldId) ?? table.fields.find((x) => x.type === 'createdAt');
  const sign = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const [va, vb] = [sortKey(f, a), sortKey(f, b)];
    const [ea, eb] = [va === '', vb === ''];
    if (ea || eb) return ea - eb || b.id - a.id; // 空值永遠排最後
    const c = typeof va === 'number' && typeof vb === 'number'
      ? va - vb
      : String(va).localeCompare(String(vb), undefined, { numeric: true });
    return sign * c || b.id - a.id;
  });
}

function matches(row, table, query) {
  if (!query) return true;
  return table.fields.some((f) => normalizeText(fieldText(f, row)).includes(query));
}

export async function mainView(id) {
  const table = await getTable(id);
  if (!table) return null;
  document.title = `${table.title} - vocab`;
  let rows = await listRows(id);
  const state = stateFor(id);
  // 從編輯頁回來時，展開並捲到剛剛那一筆
  let expanded = rows.some((r) => r.id === state.lastRowId) ? state.lastRowId : null;
  const reveal = expanded;
  state.lastRowId = null;
  let selecting = false;
  const selected = new Set();

  const columns = table.fields.filter((f) => f.showInList);
  const wrap = h('div', { class: 'table-wrap' });
  const count = h('span', { class: 'count' });
  const tagBar = h('div', { class: 'toolbar' });
  const actionBar = h('footer', { class: 'footer action-bar', hidden: true });

  const visibleRows = () => sortRows(
    rows.filter((r) => matches(r, table, normalizeText(state.query)) && (!state.tag || r.tags?.includes(state.tag))),
    table,
    state.sort,
  );

  function renderToolbar() {
    const tags = allTags(rows);
    if (state.tag && !tags.includes(state.tag)) state.tag = '';
    tagBar.replaceChildren(
      tags.length ? h('select', {
        class: 'input input-small',
        'aria-label': '依標籤篩選',
        onchange: (e) => { state.tag = e.target.value; renderTable(); },
      },
      h('option', { value: '' }, '全部標籤'),
      tags.map((t) => h('option', { value: t, selected: t === state.tag }, t))) : null,
      count,
      rows.length ? h('button', {
        type: 'button',
        class: selecting ? 'btn btn-small btn-primary' : 'btn btn-small',
        onclick: () => {
          selecting = !selecting;
          selected.clear();
          expanded = null;
          renderToolbar();
          renderTable();
        },
      }, selecting ? '取消選取' : '選取') : null,
    );
  }

  function headerCell(f) {
    const active = state.sort.fieldId === f.id;
    const onclick = () => {
      if (!active) state.sort = { fieldId: f.id, dir: 'asc' };
      else if (state.sort.dir === 'asc') state.sort = { fieldId: f.id, dir: 'desc' };
      else state.sort = { ...DEFAULT_SORT };
      renderTable();
    };
    return h('th', { scope: 'col', 'aria-sort': active ? (state.sort.dir === 'asc' ? 'ascending' : 'descending') : null },
      h('button', { type: 'button', class: 'th-btn', onclick },
        f.name,
        active ? icon(state.sort.dir === 'asc' ? 'up' : 'down', 10) : null));
  }

  function detailRow(row) {
    return h('tr', { class: 'detail' },
      h('td', { colSpan: columns.length },
        h('dl', {}, table.fields.flatMap((f) => [h('dt', {}, f.name), h('dd', {}, renderValue(f, row) || '—')])),
        h('div', { class: 'detail-actions' },
          h('button', {
            type: 'button',
            class: 'btn btn-small',
            onclick: async () => {
              if (!(await confirmDialog('刪除這筆資料？', '刪除後無法復原。', '刪除'))) return;
              await deleteRows([row.id]);
              rows = rows.filter((r) => r !== row);
              expanded = null;
              renderToolbar();
              renderTable();
            },
          }, '刪除'),
          h('a', { class: 'btn btn-small btn-primary', href: `#/table/${id}/row/${row.id}` }, '編輯'))));
  }

  function renderTable() {
    const list = visibleRows();
    count.textContent = list.length === rows.length ? `${rows.length} 筆` : `${list.length} / ${rows.length} 筆`;
    renderActionBar();

    if (!rows.length) {
      wrap.replaceChildren(h('div', { class: 'empty' },
        h('p', {}, '還沒有資料'),
        h('a', { class: 'btn btn-primary', href: `#/table/${id}/add` }, icon('plus', 14), '新增第一筆')));
      return;
    }
    const body = list.flatMap((row) => {
      const isSelected = selected.has(row.id);
      const toggle = () => {
        if (selecting) {
          if (isSelected) selected.delete(row.id);
          else selected.add(row.id);
        } else {
          expanded = expanded === row.id ? null : row.id;
        }
        renderTable();
      };
      const tr = h('tr', {
        class: isSelected ? 'data-row selected' : 'data-row',
        'data-id': row.id,
        tabIndex: 0,
        'aria-expanded': selecting ? null : String(expanded === row.id),
        onclick: toggle,
        onkeydown: (e) => {
          if (e.key === 'Enter' || (e.key === ' ' && e.target === e.currentTarget)) {
            e.preventDefault();
            toggle();
          }
        },
      }, columns.map((f) => h('td', { class: f.type === 'number' ? 'num' : null }, renderValue(f, row))));
      return !selecting && expanded === row.id ? [tr, detailRow(row)] : [tr];
    });
    wrap.replaceChildren(h('table', {},
      h('thead', {}, h('tr', {}, columns.map(headerCell))),
      h('tbody', {}, list.length ? body : h('tr', {}, h('td', { class: 'no-match', colSpan: columns.length }, '找不到符合的資料')))));
  }

  async function batchTags() {
    const mode = h('select', { class: 'input', 'aria-label': '修改方式' },
      h('option', { value: 'add' }, '加上標籤'),
      h('option', { value: 'remove' }, '移除標籤'),
      h('option', { value: 'replace' }, '取代全部標籤'));
    const input = h('input', { type: 'text', class: 'input', placeholder: '多個標籤用頓號或逗號分隔', 'aria-label': '標籤' });
    const ok = await openDialog({
      title: `修改 ${selected.size} 筆的標籤`,
      body: [mode, input],
      actions: [{ label: '取消', value: false }, { label: '套用', value: true, primary: true }],
    });
    if (!ok) return;
    const tags = parseTags(input.value);
    const changed = rows.filter((r) => selected.has(r.id));
    for (const row of changed) {
      const current = row.tags ?? [];
      if (mode.value === 'add') row.tags = [...new Set([...current, ...tags])];
      else if (mode.value === 'remove') row.tags = current.filter((t) => !tags.includes(t));
      else row.tags = tags;
    }
    await putRows(changed);
    toast(`已修改 ${changed.length} 筆`);
    renderToolbar();
    renderTable();
  }

  function renderActionBar() {
    actionBar.hidden = !selecting;
    if (!selecting) return;
    const list = visibleRows();
    const allOn = list.length > 0 && list.every((r) => selected.has(r.id));
    const none = selected.size === 0;
    actionBar.replaceChildren(
      h('button', {
        type: 'button',
        class: 'btn btn-small',
        onclick: () => {
          for (const r of list) {
            if (allOn) selected.delete(r.id);
            else selected.add(r.id);
          }
          renderTable();
        },
      }, allOn ? '全不選' : '全選'),
      h('span', { class: 'count' }, `已選 ${selected.size}`),
      h('button', { type: 'button', class: 'btn btn-small', disabled: none, onclick: batchTags }, '改標籤'),
      h('button', {
        type: 'button',
        class: 'btn btn-small',
        disabled: none,
        onclick: async () => {
          if (!(await confirmDialog(`刪除 ${selected.size} 筆資料？`, '刪除後無法復原。', '刪除'))) return;
          await deleteRows([...selected]);
          rows = rows.filter((r) => !selected.has(r.id));
          selected.clear();
          selecting = rows.length > 0;
          renderToolbar();
          renderTable();
        },
      }, '刪除'));
  }

  renderToolbar();
  renderTable();
  if (reveal !== null) {
    requestAnimationFrame(() => wrap.querySelector(`[data-id="${reveal}"]`)?.scrollIntoView({ block: 'center' }));
  }

  return h('div', { class: 'view' },
    h('header', { class: 'main-head' },
      h('div', { class: 'main-title' },
        h('a', { class: 'icon-btn', href: '#/', 'aria-label': '回首頁' }, icon('back')),
        h('h1', {}, table.title),
        h('div', { class: 'main-actions' },
          h('a', { class: 'icon-btn boxed', href: `#/table/${id}/add`, 'aria-label': '新增', title: '新增' }, icon('plus')),
          h('a', { class: 'icon-btn boxed', href: `#/table/${id}/settings`, 'aria-label': '設定', title: '設定' }, icon('star')),
          h('a', { class: 'icon-btn boxed', href: `#/table/${id}/flashcard`, 'aria-label': 'Flash Card', title: 'Flash Card' }, icon('f')),
          h('a', { class: 'icon-btn boxed', href: `#/table/${id}/quiz`, 'aria-label': '測驗', title: '測驗' }, icon('t')))),
      h('div', { class: 'main-sub' },
        table.description ? h('p', { class: 'description' }, table.description) : null,
        h('label', { class: 'search' },
          icon('search', 16),
          h('input', {
            type: 'search',
            placeholder: '搜尋',
            'aria-label': '搜尋',
            value: state.query,
            oninput: (e) => { state.query = e.target.value; expanded = null; renderTable(); },
          })))),
    tagBar,
    wrap,
    actionBar);
}

function fieldInput(f, value) {
  if (f.type === 'date') return h('input', { type: 'date', class: 'input', value });
  if (f.type === 'number') return h('input', { type: 'text', inputMode: 'decimal', class: 'input', value });
  const area = h('textarea', {
    class: 'input',
    rows: 1,
    value,
    oninput: () => {
      area.style.height = 'auto';
      area.style.height = `${area.scrollHeight}px`;
    },
  });
  return area;
}

function showImportReport(report) {
  return openDialog({
    title: '匯入結果',
    body: [
      h('p', {}, `新增 ${report.rows.length} 筆`),
      report.skipped ? h('p', {}, `跳過重複 ${report.skipped} 筆`) : null,
      report.errors.length ? [
        h('p', {}, `格式錯誤 ${report.errors.length} 筆，沒有匯入：`),
        h('ul', { class: 'report-list' }, report.errors.map((e) => h('li', {}, e))),
      ] : null,
      report.unknown.length ? h('p', {}, `略過不存在的欄位代號：${report.unknown.join('、')}`) : null,
    ],
  });
}

// rowId 為空時是新增，否則是編輯
export async function rowFormView(id, rowId = null) {
  const table = await getTable(id);
  if (!table) return null;
  const row = rowId ? await getRow(rowId) : null;
  if (rowId && (!row || row.tableId !== id)) return null;
  document.title = `${row ? '編輯' : '新增'} - ${table.title}`;
  const back = `#/table/${id}`;
  if (row) stateFor(id).lastRowId = row.id;
  const fields = table.fields.filter((f) => f.type !== 'createdAt');
  const inputs = new Map();
  const messages = new Map();

  const pickers = [];
  async function renderChips() {
    const tags = allTags(await listRows(id));
    for (const { picker, input } of pickers) {
      picker.hidden = !tags.length;
      picker.replaceChildren(...tags.map((t) => h('button', {
        type: 'button',
        class: 'tag tag-btn',
        onclick: () => {
          const current = parseTags(input.value);
          input.value = (current.includes(t) ? current.filter((x) => x !== t) : [...current, t]).join('、');
        },
      }, t)));
    }
  }

  const form = h('div', { class: 'form' });
  for (const f of fields) {
    const initial = row ? fieldValue(f, row) : '';
    const input = f.type === 'tags'
      ? h('input', { type: 'text', class: 'input', value: row ? initial.join('、') : '', placeholder: '多個標籤用頓號或逗號分隔' })
      : fieldInput(f, initial);
    const message = h('p', { class: 'error', hidden: true });
    input.addEventListener('input', () => {
      message.hidden = true;
      input.classList.remove('invalid');
    });
    // 單行欄位按 Enter 送出；多行文字按 Enter 換行，要用 ⌘／Ctrl + Enter
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      if (input.tagName === 'TEXTAREA' && !e.metaKey && !e.ctrlKey) return;
      e.preventDefault();
      save();
    });
    inputs.set(f, input);
    messages.set(f, message);
    const label = `${f.required ? '*' : ''}${f.name}`;
    form.append(h('label', { class: 'row-input' }, h('span', {}, label), input), message);
    if (f.type === 'tags') {
      const picker = h('div', { class: 'tag-picker', hidden: true });
      pickers.push({ picker, input });
      form.append(picker);
    }
  }
  await renderChips();

  const snapshot = () => JSON.stringify([...inputs.values()].map((i) => i.value));
  let initial = snapshot();
  requestAnimationFrame(() => {
    for (const input of inputs.values()) if (input.tagName === 'TEXTAREA') input.dispatchEvent(new Event('input'));
  });

  function collect() {
    const next = { values: {}, tags: [] };
    let firstBad = null;
    for (const f of fields) {
      const input = inputs.get(f);
      const message = messages.get(f);
      let error;
      if (f.type === 'tags') next.tags = parseTags(input.value);
      else {
        const out = coerceValue(f, input.value);
        error = out.error;
        if (!error && out.value !== '') next.values[f.id] = out.value;
      }
      message.hidden = !error;
      message.textContent = error ?? '';
      input.classList.toggle('invalid', Boolean(error));
      if (error) firstBad ??= input;
    }
    if (firstBad) {
      firstBad.focus();
      return null;
    }
    return next;
  }

  async function save() {
    const next = collect();
    if (!next) return;
    if (row) {
      await putRows([{ ...row, ...next }]);
      go(back, { force: true });
      return;
    }
    const key = keyField(table.fields);
    const value = keyOf(key, next);
    const existing = await listRows(id);
    const dup = value && existing.some((r) => keyOf(key, r) === value);
    await addRows(id, [{ ...next, createdAt: new Date().toISOString() }]);
    toast(dup ? `已新增，但已有相同的「${key.name}」` : `已新增「${value || '一筆資料'}」`);
    for (const input of inputs.values()) {
      input.value = '';
      if (input.tagName === 'TEXTAREA') input.style.height = '';
    }
    initial = snapshot();
    renderChips();
    [...inputs.values()][0].focus();
  }

  async function importRows() {
    const file = await pickFile();
    if (!file) return;
    try {
      const report = parseRows(table.fields, await readJsonFile(file), await listRows(id));
      await addRows(id, report.rows);
      await showImportReport(report);
      if (report.rows.length) go(back, { force: true });
    } catch (e) {
      openDialog({ title: '無法匯入', body: [h('p', {}, e.message)] });
    }
  }

  const view = h('div', { class: 'view' },
    topbar(row ? '編輯' : `新增到「${table.title}」`, () => go(back)),
    h('div', { class: 'scroll' }, form),
    h('footer', { class: 'footer' },
      row
        ? h('button', {
          type: 'button',
          class: 'btn',
          onclick: async () => {
            if (!(await confirmDialog('刪除這筆資料？', '刪除後無法復原。', '刪除'))) return;
            await deleteRows([row.id]);
            go(back, { force: true });
          },
        }, '刪除')
        : h('button', { type: 'button', class: 'btn', onclick: importRows }, '匯入'),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: save }, '確定')));
  view.leaveGuard = {
    isDirty: () => snapshot() !== initial,
    title: '要離開嗎？',
    message: '還沒按「確定」的內容不會保存。',
    okLabel: '捨棄並離開',
  };
  return view;
}
