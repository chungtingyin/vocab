// 測驗：設定頁、作答頁、紀錄總覽、單次紀錄

import { addRecord, addRecords, deleteRecord, getRecord, getTable, listRecords, listRows, saveTable } from './db.js';
import { fieldText, formatDate, keyField } from './model.js';
import { checkbox, faceContent, pickTags, shuffle, startFlashSession } from './flashcard.js';
import { allTags, sortRows, stateFor } from './rows.js';
import { exportRecords, parseRecords, readJsonFile } from './transfer.js';
import { askDeleteWithDownloads, attachSwipe, confirmDialog, go, h, icon, openDialog, pickFile, topbar } from './ui.js';

// 作答中的考卷只放在記憶體，重新整理後會回到設定頁
let session = null;

const MODE_LABELS = { choice: '四選一', fill: '填空' };

function defaultSettings(table) {
  const key = keyField(table.fields);
  const second = table.fields.find((f) => !f.system && f !== key);
  return { front: [key.id], back: second?.id ?? null, count: '', tags: [], mode: 'choice', order: 'random' };
}

function loadSettings(table, tags) {
  const settings = { ...defaultSettings(table), ...table.quiz };
  const ids = new Set(table.fields.map((f) => f.id));
  settings.front = settings.front.filter((id) => ids.has(id));
  if (!ids.has(settings.back)) settings.back = null;
  settings.tags = settings.tags.filter((t) => tags.includes(t));
  return settings;
}

function normalize(text) {
  return String(text).normalize('NFKC').trim().toLowerCase();
}

// 回答以「、」「;」分隔時，答對其中一個就算對
function acceptedAnswers(answer, reading) {
  const parts = [answer, ...answer.split(/[、;；]/)];
  if (reading) parts.push(reading);
  return [...new Set(parts.map(normalize).filter(Boolean))];
}

function buildQuestion(row, table, frontFields, backField, pool, mode) {
  const answer = fieldText(backField, row);
  const readingField = backField === keyField(table.fields) ? table.fields.find((f) => f.code === 'reading') : null;
  return {
    rowId: row.id,
    front: frontFields
      .map((f) => ({ name: f.name, value: fieldText(f, row) }))
      .filter((x) => x.value),
    answer,
    accepted: acceptedAnswers(answer, readingField ? fieldText(readingField, row) : ''),
    options: mode === 'choice'
      ? shuffle([answer, ...shuffle(pool.filter((x) => x !== answer)).slice(0, 3)])
      : null,
    userAnswer: '',
    correct: false,
  };
}

function isCorrect(q, mode) {
  if (mode === 'choice') return q.userAnswer === q.answer;
  return q.accepted.includes(normalize(q.userAnswer));
}

export async function quizSetupView(id) {
  const table = await getTable(id);
  if (!table) return null;
  document.title = `測驗 - ${table.title}`;
  session = null;
  const rows = await listRows(id);
  const tags = allTags(rows);
  const settings = loadSettings(table, tags);

  const frontFields = () => table.fields.filter((f) => settings.front.includes(f.id));
  const backField = () => table.fields.find((f) => f.id === settings.back);

  // 沒有題目內容或沒有答案的資料不能出題
  const matched = () => {
    const front = frontFields();
    const back = backField();
    return rows.filter((r) => (!settings.tags.length || r.tags?.some((t) => settings.tags.includes(t)))
      && (!back || fieldText(back, r))
      && (!front.length || front.some((f) => fieldText(f, r))));
  };

  const available = h('p', { class: 'fc-available' });
  const tagLabel = h('span', {});
  const error = h('p', { class: 'error', hidden: true });

  function refresh() {
    if (!tags.length) tagLabel.textContent = '沒有標籤';
    else tagLabel.textContent = settings.tags.length ? settings.tags.join('、') : '全部標籤';
    available.textContent = `目前符合 ${matched().length} 題`;
  }

  const nameInput = h('input', {
    type: 'text',
    class: 'input',
    'aria-label': '本次測驗名稱',
    placeholder: `本次測驗名稱（預設：${table.title}測驗）`,
  });

  const questionPanel = h('fieldset', { class: 'fc-panel' },
    h('legend', {}, '題目（可多選）'),
    table.fields.map((f) => checkbox(f.name, settings.front.includes(f.id), (on) => {
      settings.front = on ? [...settings.front, f.id] : settings.front.filter((x) => x !== f.id);
      refresh();
    })));
  const answerPanel = h('fieldset', { class: 'fc-panel' },
    h('legend', {}, '回答（單選）'),
    table.fields.map((f) => h('label', { class: 'check' },
      h('input', {
        type: 'radio',
        name: 'quiz-answer',
        checked: settings.back === f.id,
        onchange: () => {
          settings.back = f.id;
          refresh();
        },
      }),
      h('span', { class: 'check-box' }, icon('check', 14)),
      h('span', {}, f.name))));

  const countInput = h('input', {
    type: 'text',
    inputMode: 'numeric',
    class: 'input',
    id: 'qz-count',
    value: settings.count,
    placeholder: '全部',
    oninput: (e) => { settings.count = e.target.value.trim(); },
  });
  const tagButton = h('button', {
    type: 'button',
    class: 'input fc-tag-btn',
    id: 'qz-tags',
    disabled: !tags.length,
    onclick: async () => {
      const next = await pickTags(tags, settings.tags);
      if (next) settings.tags = next;
      refresh();
    },
  }, tagLabel);
  const select = (label, key, options) => h('select', {
    class: 'input',
    'aria-label': label,
    onchange: (e) => { settings[key] = e.target.value; },
  }, Object.entries(options).map(([value, text]) => h('option', { value, selected: settings[key] === value }, text)));

  refresh();

  function fail(message) {
    error.textContent = message;
    error.hidden = false;
  }

  async function start() {
    const front = frontFields();
    const back = backField();
    if (!front.length) return fail('題目至少要選一個欄位');
    if (!back) return fail('請選一個回答欄位');
    if (front.includes(back)) return fail(`「${back.name}」是回答，不能同時顯示在題目`);
    if (settings.count && (!/^\d+$/.test(settings.count) || Number(settings.count) < 1)) {
      return fail('題目數量要是大於 0 的整數，留空代表全部');
    }
    const list = matched();
    if (!list.length) return fail(rows.length ? '沒有符合條件的資料' : '這張表格還沒有資料');

    const pool = [...new Set(rows.map((r) => fieldText(back, r)).filter(Boolean))];
    if (settings.mode === 'choice' && pool.length < 4) {
      return fail(`四選一需要至少 4 個不同的「${back.name}」，請新增資料或改用填空`);
    }

    await saveTable({ ...table, quiz: settings });
    const ordered = settings.order === 'sorted' ? sortRows(list, table, stateFor(id).sort) : shuffle(list);
    const wanted = settings.count ? Number(settings.count) : ordered.length;
    session = {
      tableId: id,
      name: nameInput.value.trim() || `${table.title}測驗`,
      mode: settings.mode,
      order: settings.order,
      tags: settings.tags,
      questions: ordered.slice(0, wanted).map((r) => buildQuestion(r, table, front, back, pool, settings.mode)),
    };
    go(`#/table/${id}/quiz/play`);
    return undefined;
  }

  return h('div', { class: 'view' },
    topbar('測驗', () => go(`#/table/${id}`),
      h('a', { class: 'icon-btn boxed', href: `#/table/${id}/quiz/records`, 'aria-label': '測驗紀錄', title: '測驗紀錄' }, icon('floppy', 22))),
    h('div', { class: 'scroll' },
      h('div', { class: 'form' },
        nameInput,
        h('div', { class: 'fc-panels qz-panels' }, questionPanel, answerPanel),
        h('div', { class: 'fc-options' },
          h('div', {},
            h('label', { class: 'fc-label', for: 'qz-count' }, '題目數量'),
            countInput,
            available),
          h('div', {},
            h('label', { class: 'fc-label', for: 'qz-tags' }, '標籤'),
            tagButton)),
        h('div', { class: 'qz-mode' },
          h('p', { class: 'fc-label' }, '作答方式'),
          select('作答方式', 'mode', { choice: '四選一', fill: '填空' })),
        error)),
    h('footer', { class: 'footer' },
      h('div', { class: 'fc-order' }, select('題目順序', 'order', { sorted: '按照表格排序', random: '隨機' })),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: start }, 'START')));
}

function questionFace(q) {
  const fields = q.front.map((x, i) => ({ id: `f${i}`, name: x.name, type: 'text' }));
  const values = Object.fromEntries(q.front.map((x, i) => [`f${i}`, x.value]));
  return { fields, row: { values, tags: [] } };
}

function formatClock(seconds) {
  const pad = (n) => String(n).padStart(2, '0');
  const h24 = Math.floor(seconds / 3600);
  const body = `${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`;
  return h24 ? `${h24}:${body}` : body;
}

export async function quizPlayView(id) {
  if (session?.tableId !== id) {
    history.replaceState(null, '', `#/table/${id}/quiz`);
    return quizSetupView(id);
  }
  const current = session;
  const { questions, mode } = current;
  current.startedAt ??= Date.now();
  document.title = `測驗 - ${current.name}`;
  let index = 0;

  const elapsed = () => Math.floor((Date.now() - current.startedAt) / 1000);
  const timer = h('span', { class: 'qz-timer', role: 'timer', 'aria-label': '已用時間' }, formatClock(0));
  const stage = h('div', { class: 'qz-stage' });
  const counter = h('span', { class: 'count' });
  const prev = h('button', { type: 'button', class: 'icon-btn boxed fc-arrow', 'aria-label': '上一題', onclick: () => move(-1) }, icon('back', 24));
  const next = h('button', { type: 'button', class: 'icon-btn boxed fc-arrow', 'aria-label': '下一題', onclick: () => move(1) }, icon('forward', 24));

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function move(step) {
    const target = index + step;
    if (target < 0 || target > questions.length) return;
    index = target;
    render();
    if (!reduceMotion) {
      stage.firstElementChild.animate(
        [{ transform: `translateX(${step * 32}px)` }, { transform: 'none' }],
        { duration: 120, easing: 'steps(4)' },
      );
    }
    stage.querySelector('input')?.focus({ preventScroll: true });
  }

  function answerArea(q) {
    if (mode === 'fill') {
      return h('input', {
        type: 'text',
        class: 'input qz-fill',
        value: q.userAnswer,
        placeholder: '輸入答案',
        'aria-label': '答案',
        autocomplete: 'off',
        autocapitalize: 'off',
        spellcheck: false,
        oninput: (e) => { q.userAnswer = e.target.value; },
        onkeydown: (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            move(1);
          }
        },
      });
    }
    return h('div', { class: 'qz-options' }, q.options.map((option, i) => h('button', {
      type: 'button',
      class: q.userAnswer === option ? 'btn btn-primary qz-option' : 'btn qz-option',
      'aria-pressed': String(q.userAnswer === option),
      onclick: () => {
        q.userAnswer = q.userAnswer === option ? '' : option;
        const area = stage.querySelector('.qz-options');
        area.replaceWith(answerArea(q));
      },
    }, h('span', { class: 'qz-number' }, String(i + 1)), h('span', {}, option))));
  }

  function questionScreen(q) {
    const { fields, row } = questionFace(q);
    const card = h('div', { class: 'fc-card qz-card' },
      h('span', { class: 'fc-face' }, `第 ${index + 1} 題`),
      h('div', { class: 'fc-content' }, faceContent(fields, row)));
    attachSwipe(card, { onSwipe: move });
    return h('div', { class: 'qz-question' }, card, answerArea(q));
  }

  async function submit(button) {
    button.disabled = true;
    for (const q of questions) q.correct = isCorrect(q, mode);
    const recordId = await addRecord({
      tableId: id,
      name: current.name,
      finishedAt: new Date().toISOString(),
      durationSeconds: elapsed(),
      mode,
      order: current.order,
      tags: current.tags,
      score: questions.filter((q) => q.correct).length,
      total: questions.length,
      questions,
    });
    session = null;
    location.replace(`#/table/${id}/quiz/records/${recordId}`);
  }

  function submitScreen() {
    const blanks = questions
      .map((q, i) => (normalize(q.userAnswer) ? null : i + 1))
      .filter(Boolean);
    const button = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => submit(button) }, '交卷');
    return h('div', { class: 'qz-question' },
      h('div', { class: 'fc-card fc-done' },
        h('p', { class: 'fc-big' }, '要交卷嗎？'),
        h('p', {}, `已作答 ${questions.length - blanks.length} / ${questions.length} 題`),
        blanks.length ? h('p', { class: 'error' }, `還沒作答：第 ${blanks.join('、')} 題`) : null,
        h('div', { class: 'fc-done-actions' }, button)));
  }

  function render() {
    const done = index === questions.length;
    stage.replaceChildren(done ? submitScreen() : questionScreen(questions[index]));
    counter.textContent = done ? `${questions.length} / ${questions.length}` : `${index + 1} / ${questions.length}`;
    prev.disabled = index === 0;
    next.disabled = done;
  }

  render();

  const view = h('div', { class: 'view' },
    topbar(current.name, async () => {
      if (!(await confirmDialog('離開測驗？', '這次的作答不會保存。', '離開'))) return;
      session = null;
      go(`#/table/${id}`);
    }, timer),
    stage,
    h('footer', { class: 'footer' }, prev, counter, next));

  const tick = setInterval(() => {
    if (!view.isConnected) {
      clearInterval(tick);
      return;
    }
    timer.textContent = formatClock(elapsed());
  }, 1000);

  const onKey = (e) => {
    if (!view.isConnected) {
      removeEventListener('keydown', onKey);
      return;
    }
    if (e.target.tagName === 'INPUT' || document.querySelector('dialog[open]')) return;
    if (e.key === 'ArrowLeft') move(-1);
    if (e.key === 'ArrowRight') move(1);
  };
  addEventListener('keydown', onKey);
  return view;
}

function exportRecord(record) {
  exportRecords(record.name, [record]);
}

function formatTime(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export async function recordsView(id) {
  const table = await getTable(id);
  if (!table) return null;
  document.title = `測驗紀錄 - ${table.title}`;
  let records = (await listRecords(id)).sort((a, b) => b.id - a.id);
  let deleting = false;

  const wrap = h('div', { class: 'table-wrap qz-records' });
  const hint = h('p', { class: 'home-hint', hidden: true }, '按 ✕ 刪除紀錄，再按一次筆形按鈕結束');
  const pencil = h('button', {
    type: 'button',
    class: 'icon-btn',
    'aria-label': '刪除模式',
    onclick: () => {
      deleting = !deleting;
      render();
    },
  }, icon('pencil'));

  const exportButton = h('button', { type: 'button', class: 'btn', onclick: () => exportRecords(table.title, records) }, '匯出全部');

  // 只新增不覆蓋；同名且同時間交卷的視為同一份
  async function importFile() {
    const file = await pickFile();
    if (!file) return;
    try {
      const payload = await readJsonFile(file);
      if (!Array.isArray(payload?.records)) throw new Error('這個檔案沒有測驗紀錄');
      const parsed = parseRecords(payload);
      const seen = new Set(records.map((r) => `${r.name}|${r.finishedAt}`));
      const fresh = parsed.records.filter((r) => {
        const key = `${r.name}|${r.finishedAt}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      await addRecords(id, fresh);
      records = (await listRecords(id)).sort((a, b) => b.id - a.id);
      render();
      const duplicates = parsed.records.length - fresh.length;
      await openDialog({
        title: '匯入結果',
        body: [
          h('p', {}, `新增 ${fresh.length} 筆紀錄`),
          duplicates ? h('p', {}, `跳過重複 ${duplicates} 筆`) : null,
          parsed.skipped ? h('p', {}, `內容不完整 ${parsed.skipped} 筆，沒有匯入`) : null,
        ],
      });
    } catch (e) {
      openDialog({ title: '無法匯入', body: [h('p', {}, e.message)] });
    }
  }

  function actionCell(record) {
    if (!deleting) {
      return h('a', {
        class: 'icon-btn boxed qz-open',
        href: `#/table/${id}/quiz/records/${record.id}`,
        'aria-label': `查看 ${record.name}`,
      }, icon('forward', 18));
    }
    return h('button', {
      type: 'button',
      class: 'icon-btn boxed qz-open',
      'aria-label': `刪除 ${record.name}`,
      onclick: async () => {
        const ok = await askDeleteWithDownloads(
          `刪除「${record.name}」？`,
          '這次測驗紀錄會刪除，無法復原。需要的檔案請先下載：',
          [{ label: '這次測驗紀錄', download: () => exportRecord(record) }],
        );
        if (!ok) return;
        await deleteRecord(record.id);
        records = records.filter((r) => r !== record);
        if (!records.length) deleting = false;
        render();
      },
    }, icon('close', 14));
  }

  function render() {
    pencil.setAttribute('aria-pressed', String(deleting));
    pencil.classList.toggle('active', deleting);
    pencil.disabled = !records.length;
    exportButton.disabled = !records.length;
    hint.hidden = !deleting;
    if (!records.length) {
      wrap.replaceChildren(h('div', { class: 'empty' },
        h('p', {}, '還沒有測驗紀錄'),
        h('a', { class: 'btn btn-primary', href: `#/table/${id}/quiz` }, '開始測驗')));
      return;
    }
    wrap.replaceChildren(h('table', {},
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col' }, h('span', { class: 'th-text' }, '時間')),
        h('th', { scope: 'col' }, h('span', { class: 'th-text' }, '考卷名稱')),
        h('th', { scope: 'col' }, h('span', { class: 'th-text' }, '分數')),
        h('th', { scope: 'col', class: 'col-action', 'aria-label': deleting ? '刪除' : '查看' }))),
      h('tbody', {}, records.map((r) => h('tr', {},
        h('td', { class: 'qz-time' }, formatDate(r.finishedAt), h('br'), formatTime(r.finishedAt)),
        h('td', {}, r.name),
        h('td', { class: 'num' }, `${r.score}/${r.total}`),
        h('td', { class: 'col-action' }, actionCell(r)))))));
  }

  render();
  return h('div', { class: 'view' },
    topbar('測驗紀錄', () => go(`#/table/${id}`), pencil),
    hint,
    h('div', { class: 'qz-records-body' }, wrap),
    h('footer', { class: 'footer' },
      h('button', { type: 'button', class: 'btn', onclick: importFile }, '匯入'),
      exportButton));
}

function retestSession(record, questions, suffix) {
  const order = record.order === 'random' ? shuffle(questions) : questions;
  return {
    tableId: record.tableId,
    name: `${record.name.replace(/（(錯題)?重測）$/, '')}${suffix}`,
    mode: record.mode,
    order: record.order,
    tags: record.tags,
    questions: order.map((q) => ({
      ...q,
      options: q.options ? shuffle(q.options) : null,
      userAnswer: '',
      correct: false,
    })),
  };
}

export async function recordView(id, recordId) {
  const table = await getTable(id);
  const record = await getRecord(recordId);
  if (!table || !record || record.tableId !== id) return null;
  document.title = `${record.name} - 測驗紀錄`;
  const self = `#/table/${id}/quiz/records/${recordId}`;
  const scoreLine = h('p', { class: 'qz-score' });
  const wrap = h('div', { class: 'table-wrap' });
  const retestWrong = h('div', { class: 'qz-record-actions' });

  function retest(questions, suffix) {
    session = retestSession(record, questions, suffix);
    go(`#/table/${id}/quiz/play`);
  }

  function review() {
    const sample = record.questions[0];
    const front = sample.front.map((x, i) => ({ id: `f${i}`, name: x.name, type: 'text' }));
    const cards = record.questions.map((q) => ({
      values: { ...Object.fromEntries(q.front.map((x, i) => [`f${i}`, x.value])), answer: q.answer },
      tags: [],
    }));
    startFlashSession({
      tableId: id,
      title: record.name,
      front,
      back: [{ id: 'answer', name: '解答', type: 'text' }],
      cards,
      backHash: self,
      backLabel: '回到紀錄',
    });
    go(`#/table/${id}/flashcard/play`);
  }

  function resultCell(q) {
    if (q.correct) return h('td', {}, h('span', { class: 'qz-mark' }, icon('check', 14), '正確'));
    return h('td', { class: 'qz-wrong' },
      h('span', { class: 'qz-mark' }, icon('close', 12), '錯誤'),
      h('p', { class: 'qz-user' }, normalize(q.userAnswer) ? `你的答案：${q.userAnswer}` : '沒有作答'));
  }

  function render() {
    const wrong = record.questions.filter((q) => !q.correct);
    scoreLine.textContent = `${record.score}/${record.total} 分 · ${MODE_LABELS[record.mode]} · 用時 ${formatClock(record.durationSeconds)} · ${formatDate(record.finishedAt)} ${formatTime(record.finishedAt)}`;
    retestWrong.replaceChildren(...(wrong.length
      ? [h('button', { type: 'button', class: 'btn btn-small', onclick: () => retest(wrong, '（錯題重測）') }, `只重考 ${wrong.length} 題錯題`)]
      : []));
    wrap.replaceChildren(h('table', {},
      h('thead', {}, h('tr', {},
        ['題目', '解答', '正確錯誤'].map((t) => h('th', { scope: 'col' }, h('span', { class: 'th-text' }, t))))),
      h('tbody', {}, record.questions.map((q) => h('tr', {},
        h('td', {}, q.front.map((x) => h('div', {}, x.value))),
        h('td', {}, q.answer),
        resultCell(q))))));
  }

  render();
  return h('div', { class: 'view' },
    topbar('', () => go(`#/table/${id}/quiz/records`),
      h('div', { class: 'qz-head-actions' },
        h('button', { type: 'button', class: 'btn btn-small', onclick: () => exportRecord(record) }, '匯出'),
        h('button', { type: 'button', class: 'btn btn-small', 'aria-label': 'Flash Card 複習', onclick: review }, icon('f', 14), '複習'),
        h('button', { type: 'button', class: 'btn btn-small', onclick: () => retest(record.questions, '（重測）') }, '整份重測'))),
    h('div', { class: 'qz-title' }, h('h1', {}, record.name), scoreLine, retestWrong),
    wrap);
}
