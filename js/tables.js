import { deleteTable, listRecords, listRows, listTables } from './db.js';
import { tableDownloads } from './transfer.js';
import { askDeleteWithDownloads, firstChar, go, h, icon, logo, pixelGlyph, toggleTheme } from './ui.js';

async function askDelete(table) {
  const [rows, records] = await Promise.all([listRows(table.id), listRecords(table.id)]);
  return askDeleteWithDownloads(
    `刪除「${table.title}」？`,
    `表格、${rows.length} 筆資料和 ${records.length} 筆測驗紀錄都會刪除，無法復原。需要的檔案請先下載：`,
    tableDownloads(table, rows, records),
  );
}

export async function homeView() {
  let tables = await listTables();
  let deleting = false;
  document.title = 'vocab';

  const tiles = h('div', { class: 'tiles' });
  const hint = h('p', { class: 'home-hint', hidden: true }, '點選要刪除的表格，再按一次筆形按鈕結束');
  const empty = h('p', { class: 'home-empty', hidden: true }, '還沒有表格，點 ＋ 建立第一張');
  const pencil = h('button', {
    type: 'button',
    class: 'icon-btn',
    'aria-label': '刪除模式',
    onclick: () => {
      deleting = !deleting;
      render();
    },
  }, icon('pencil'));

  function tile(t) {
    const content = [
      h('span', { class: 'tile-glyph' }, pixelGlyph(firstChar(t.title), 72)),
      h('span', { class: 'tile-name' }, t.title),
    ];
    if (!deleting) return h('a', { class: 'tile', href: `#/table/${t.id}` }, content);
    return h('button', {
      type: 'button',
      class: 'tile tile-deleting',
      'aria-label': `刪除 ${t.title}`,
      onclick: async () => {
        if (!(await askDelete(t))) return;
        await deleteTable(t.id);
        tables = tables.filter((x) => x !== t);
        if (!tables.length) deleting = false;
        render();
      },
    }, content, h('span', { class: 'tile-badge' }, icon('close', 12)));
  }

  function render() {
    pencil.setAttribute('aria-pressed', String(deleting));
    pencil.classList.toggle('active', deleting);
    pencil.disabled = !tables.length;
    hint.hidden = !deleting;
    empty.hidden = tables.length > 0;
    tiles.replaceChildren(
      ...tables.map(tile),
      ...(deleting ? [] : [h('button', { type: 'button', class: 'tile tile-add', 'aria-label': '新增表格', onclick: () => go('#/new') },
        h('span', { class: 'tile-glyph' }, icon('plus', 72)))]),
    );
  }

  render();
  return h('div', { class: 'view' },
    h('header', { class: 'home-head' },
      h('div', { class: 'logo', role: 'img', 'aria-label': 'vocab' }, logo(116)),
      h('div', { class: 'home-actions' },
        pencil,
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': '切換深色模式', onclick: toggleTheme }, icon('theme')))),
    h('div', { class: 'dither' }),
    hint,
    h('div', { class: 'scroll' }, empty, tiles));
}
