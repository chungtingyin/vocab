// 新增表格和 ∗ 設定頁共用的表單

import { createTable, deleteTable, getTable, listRecords, listRows, saveTable } from './db.js';
import { FIELD_TYPES, blankField, blankFields, validateFields, vocabFields } from './model.js';
import { buildTemplate, downloadJson, exportFullTable, parseRecords, parseRows, parseTableFile, readJsonFile, tableDownloads } from './transfer.js';
import { askDeleteWithDownloads, confirmDialog, go, h, icon, openDialog, pickFile, toast, topbar } from './ui.js';

function fieldEditor(initial, confirmRemove) {
  let fields = initial.map((f) => ({ ...f }));
  let errors = {};
  const list = h('div', { class: 'field-list' });

  function reorderFromDom() {
    const order = [...list.children].map((c) => c.dataset.id);
    fields.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    render();
  }

  function dragHandle(card, f) {
    const onMove = (e) => {
      const scroller = list.closest('.scroll');
      const box = scroller.getBoundingClientRect();
      if (e.clientY < box.top + 48) scroller.scrollTop -= 8;
      else if (e.clientY > box.bottom - 48) scroller.scrollTop += 8;
      const prev = card.previousElementSibling;
      const next = card.nextElementSibling;
      if (prev) {
        const r = prev.getBoundingClientRect();
        // 只移動旁邊的卡片：把被拖的元素移出 DOM 會讓瀏覽器放掉 pointer capture
        if (e.clientY < r.top + r.height / 2) return list.insertBefore(prev, card.nextSibling);
      }
      if (next) {
        const r = next.getBoundingClientRect();
        if (e.clientY > r.top + r.height / 2) list.insertBefore(next, card);
      }
    };
    return h('button', {
      type: 'button',
      class: 'icon-btn grip',
      'aria-label': `移動欄位 ${f.name}，可用方向鍵調整`,
      onpointerdown: (e) => {
        e.preventDefault();
        const handle = e.currentTarget;
        handle.setPointerCapture(e.pointerId);
        card.classList.add('dragging');
        handle.addEventListener('pointermove', onMove);
        const end = () => {
          handle.removeEventListener('pointermove', onMove);
          handle.removeEventListener('pointerup', end);
          handle.removeEventListener('pointercancel', end);
          card.classList.remove('dragging');
          reorderFromDom();
        };
        handle.addEventListener('pointerup', end);
        handle.addEventListener('pointercancel', end);
      },
      onkeydown: (e) => {
        const i = fields.indexOf(f);
        const j = e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowDown' ? i + 1 : -1;
        if (j < 0 || j >= fields.length) return;
        e.preventDefault();
        [fields[i], fields[j]] = [fields[j], fields[i]];
        render();
        list.querySelector(`[data-id="${f.id}"] .grip`).focus();
      },
    }, icon('grip', 16));
  }

  function eyeToggle(f) {
    return h('button', {
      type: 'button',
      class: 'icon-btn',
      'aria-pressed': String(f.showInList),
      'aria-label': `${f.showInList ? '隱藏' : '顯示'}欄位 ${f.name}`,
      onclick: () => {
        if (f.showInList && fields.filter((x) => x.showInList).length === 1) {
          toast('至少要顯示一個欄位');
          return;
        }
        f.showInList = !f.showInList;
        render();
      },
    }, icon(f.showInList ? 'eye' : 'eyeOff', 22));
  }

  function textRow(label, f, key, placeholder, disabled) {
    const message = errors[f.id]?.[key];
    return [
      h('label', { class: 'row-input' },
        h('span', {}, label),
        h('input', {
          type: 'text',
          class: message ? 'input invalid' : 'input',
          value: f[key],
          placeholder,
          disabled,
          autocapitalize: 'off',
          oninput: (e) => { f[key] = e.target.value; },
        })),
      ...(message ? [h('p', { class: 'error' }, message)] : []),
    ];
  }

  function card(f, number) {
    const el = h('div', { class: f.system ? 'field-card system' : 'field-card', 'data-id': f.id });
    const head = h('div', { class: 'field-head' }, eyeToggle(f), dragHandle(el, f));
    if (f.system) {
      el.append(head);
      head.append(h('input', {
        type: 'text',
        class: errors[f.id]?.name ? 'input invalid' : 'input',
        value: f.name,
        'aria-label': '系統欄位名稱',
        oninput: (e) => { f.name = e.target.value; },
      }), h('span', { class: 'badge' }, '系統'));
      if (errors[f.id]?.name) el.append(h('p', { class: 'error' }, errors[f.id].name));
      return el;
    }
    head.append(
      h('strong', { class: 'field-label' }, `*欄位${number}`),
      h('button', {
        type: 'button',
        class: 'icon-btn field-remove',
        'aria-label': `刪除欄位${number}`,
        onclick: async () => {
          if (fields.filter((x) => !x.system).length === 1) {
            toast('至少要有一個欄位');
            return;
          }
          if (!(await confirmRemove(f))) return;
          fields = fields.filter((x) => x !== f);
          render();
        },
      }, icon('close', 14)));
    el.append(
      head,
      ...textRow('名稱', f, 'name', '例：原文'),
      ...textRow('代號', f, 'code', 'JSON 檔使用的名稱'),
      h('div', { class: 'row-input' },
        h('label', { for: `type-${f.id}` }, '屬性'),
        h('select', {
          id: `type-${f.id}`,
          class: 'input',
          onchange: (e) => { f.type = e.target.value; },
        }, Object.entries(FIELD_TYPES).map(([value, label]) => h('option', { value, selected: f.type === value }, label))),
        h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: f.required, onchange: (e) => { f.required = e.target.checked; } }),
          h('span', { class: 'check-box' }, icon('check', 14)),
          '必填')));
    return el;
  }

  function render() {
    let n = 0;
    list.replaceChildren(...fields.map((f) => card(f, f.system ? 0 : (n += 1))));
  }

  render();
  return {
    el: h('div', {},
      list,
      h('button', {
        type: 'button',
        class: 'btn btn-wide',
        onclick: () => {
          const f = blankField(fields);
          const at = fields.findIndex((x) => x.system);
          fields.splice(at < 0 ? fields.length : at, 0, f);
          render();
          list.querySelector(`[data-id="${f.id}"] input[type=text]`).focus();
        },
      }, icon('plus', 14), '增加欄位')),
    get() {
      return fields.map((f) => ({ ...f, name: f.name.trim(), code: f.code.trim() }));
    },
    set(next) {
      fields = next.map((f) => ({ ...f }));
      errors = {};
      render();
    },
    validate() {
      errors = validateFields(this.get());
      render();
      return Object.keys(errors).length === 0;
    },
  };
}

function tableForm(table, editor) {
  const title = h('input', { type: 'text', class: 'input', id: 'table-title', value: table.title, placeholder: '例：日文' });
  const titleError = h('p', { class: 'error', hidden: true }, '請輸入標題');
  const description = h('input', { type: 'text', class: 'input', value: table.description, placeholder: '沒有填寫就不會顯示' });
  return {
    el: h('div', { class: 'form-top' },
      h('label', { class: 'row-input' }, h('span', {}, '*標題'), title),
      titleError,
      h('label', { class: 'row-input' }, h('span', {}, '說明'), description)),
    title,
    get() {
      return { title: title.value.trim(), description: description.value.trim(), fields: editor.get() };
    },
    validate() {
      const titleOk = Boolean(title.value.trim());
      titleError.hidden = titleOk;
      title.classList.toggle('invalid', !titleOk);
      const fieldsOk = editor.validate();
      if (titleOk && fieldsOk) return true;
      document.querySelector('.invalid')?.focus();
      return false;
    },
  };
}

async function leaveIfClean(isDirty, hash) {
  if (!isDirty() || await confirmDialog('要離開嗎？', '還沒按「確定」的變更不會保存。', '捨棄並離開')) go(hash);
}

export async function newTableView() {
  document.title = '新增表格 - vocab';
  const editor = fieldEditor(blankFields(), async () => true);
  const form = tableForm({ title: '', description: '' }, editor);
  const initial = JSON.stringify(form.get());

  async function importTable() {
    const file = await pickFile();
    if (!file) return;
    try {
      const payload = await readJsonFile(file);
      const draft = parseTableFile(payload);
      const report = parseRows(draft.fields, payload, []);
      const { records, skipped } = parseRecords(payload);
      const ok = await confirmDialog(
        `建立「${draft.title}」？`,
        `會建立新表格，包含 ${draft.fields.filter((f) => !f.system).length} 個欄位和 ${report.rows.length} 筆資料。`
          + (records.length ? `這個檔案也含有 ${records.length} 筆測驗紀錄，會一併建立。` : '')
          + (report.errors.length ? `另有 ${report.errors.length} 筆資料格式錯誤，不會匯入。` : '')
          + (skipped ? `另有 ${skipped} 筆測驗紀錄內容不完整，不會匯入。` : ''),
        '建立');
      if (!ok) return;
      const id = await createTable({ ...draft, createdAt: new Date().toISOString() }, report.rows, records);
      go(`#/table/${id}`);
    } catch (e) {
      openDialog({ title: '無法匯入', body: [h('p', {}, e.message)] });
    }
  }

  return h('div', { class: 'view' },
    topbar('新增表格', () => leaveIfClean(() => JSON.stringify(form.get()) !== initial, '#/')),
    h('div', { class: 'scroll' },
      h('div', { class: 'form' },
        form.el,
        h('div', { class: 'template-row' },
          h('span', {}, '從範本開始'),
          h('button', { type: 'button', class: 'btn btn-small', onclick: () => editor.set(vocabFields()) }, '單字表')),
        editor.el)),
    h('footer', { class: 'footer' },
      h('button', { type: 'button', class: 'btn', onclick: importTable }, '匯入'),
      h('button', {
        type: 'button',
        class: 'btn btn-primary',
        onclick: async () => {
          if (!form.validate()) return;
          const id = await createTable({ ...form.get(), createdAt: new Date().toISOString() });
          go(`#/table/${id}`);
        },
      }, '確定')));
}

export async function settingsView(id) {
  const table = await getTable(id);
  if (!table) return null;
  document.title = `設定 - ${table.title}`;
  const [rows, records] = await Promise.all([listRows(id), listRecords(id)]);
  const savedIds = new Set(table.fields.map((f) => f.id));

  const editor = fieldEditor(table.fields, (f) => {
    if (!savedIds.has(f.id) || !rows.length) return Promise.resolve(true);
    return confirmDialog(
      `刪除「${f.name || '這個欄位'}」？`,
      `按下「確定」儲存後，這個欄位在 ${rows.length} 筆資料裡的內容會一併刪除，無法復原。`,
      '刪除欄位');
  });
  const form = tableForm(table, editor);
  const initial = JSON.stringify(form.get());
  const back = `#/table/${id}`;

  async function exportFile() {
    if (!form.validate()) return;
    const draft = { ...table, ...form.get() };
    const choice = await openDialog({
      title: '匯出',
      body: [
        h('p', {}, h('strong', {}, '匯出格式：'), '只有欄位設定和一筆空白範例，可照著填寫後再匯入。'),
        h('p', {}, h('strong', {}, '完整表格：'), `欄位設定和全部 ${rows.length} 筆資料，可用來備份或搬到其他裝置。測驗紀錄在紀錄頁另外匯出。`),
      ],
      actions: [
        { label: '匯出格式', value: 'template' },
        { label: '完整表格', value: 'full', primary: true },
      ],
    });
    if (choice === 'template') downloadJson(`${draft.title}-格式.json`, buildTemplate(draft));
    if (choice === 'full') exportFullTable(draft, rows);
  }

  return h('div', { class: 'view' },
    topbar('設定', () => leaveIfClean(() => JSON.stringify(form.get()) !== initial, back)),
    h('div', { class: 'scroll' },
      h('div', { class: 'form' },
        form.el,
        editor.el,
        h('button', {
          type: 'button',
          class: 'btn btn-wide btn-danger',
          onclick: async () => {
            const ok = await askDeleteWithDownloads(
              `刪除「${table.title}」？`,
              `表格、${rows.length} 筆資料和 ${records.length} 筆測驗紀錄都會刪除，無法復原。需要的檔案請先下載：`,
              tableDownloads(table, rows, records),
            );
            if (!ok) return;
            await deleteTable(id);
            go('#/');
          },
        }, '刪除表格'))),
    h('footer', { class: 'footer' },
      h('button', { type: 'button', class: 'btn', onclick: exportFile }, '匯出'),
      h('button', {
        type: 'button',
        class: 'btn btn-primary',
        onclick: async () => {
          if (!form.validate()) return;
          const next = { ...table, ...form.get() };
          const nextIds = new Set(next.fields.map((f) => f.id));
          await saveTable(next, [...savedIds].filter((x) => !nextIds.has(x)));
          go(back);
        },
      }, '確定')));
}

