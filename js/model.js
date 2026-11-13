// 欄位與資料的共用規則

export const FIELD_TYPES = { text: '文字', number: '數字', date: '日期' };

export function newId() {
  return 'f_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function field(id, code, name, type, required, showInList, system = false) {
  return { id, code, name, type, required, showInList, system };
}

export function systemFields(showTags = false) {
  return [
    field('tags', 'tags', '標籤', 'tags', false, showTags, true),
    field('createdAt', 'createdAt', '加入時間', 'createdAt', false, false, true),
  ];
}

export function vocabFields() {
  return [
    field(newId(), 'original', '原文', 'text', true, true),
    field(newId(), 'translation', '翻譯', 'text', true, true),
    field(newId(), 'reading', '讀音', 'text', false, false),
    field(newId(), 'example', '例句', 'text', false, false),
    field(newId(), 'note', '備註', 'text', false, false),
    ...systemFields(true),
  ];
}

export function blankField(fields) {
  const codes = new Set(fields.map((f) => f.code));
  let n = 1;
  while (codes.has(`field${n}`)) n += 1;
  return field(newId(), `field${n}`, '', 'text', false, true);
}

export function blankFields() {
  const first = { ...blankField([]), required: true };
  return [first, ...systemFields()];
}

// 回傳 { fieldId: { name?, code? } }，沒有錯誤就是空物件
export function validateFields(fields) {
  const errors = {};
  const seen = new Set();
  for (const f of fields) {
    const e = {};
    if (!String(f.name ?? '').trim()) e.name = '請輸入欄位名稱';
    const code = String(f.code ?? '').trim();
    if (!code) e.code = '請輸入欄位代號';
    else if (!/^[\p{L}\p{N}_-]+$/u.test(code) || code === '__proto__') e.code = '代號只能用文字、數字、_ 和 -';
    else if (seen.has(code)) e.code = '代號不能重複';
    seen.add(code);
    if (Object.keys(e).length) errors[f.id] = e;
  }
  return errors;
}

function normalizeDate(raw) {
  const m = String(raw).trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return `${m[1]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// 手動輸入和 JSON 匯入共用同一套驗證
export function coerceValue(f, raw) {
  const blank = raw === null || raw === undefined || String(raw).trim() === '';
  if (blank) return f.required ? { error: `缺少「${f.name}」` } : { value: '' };
  if (typeof raw === 'object') return { error: `「${f.name}」的格式不正確` };
  if (f.type === 'number') {
    const n = Number(String(raw).trim());
    return Number.isFinite(n) ? { value: n } : { error: `「${f.name}」必須是數字` };
  }
  if (f.type === 'date') {
    const d = normalizeDate(raw);
    return d ? { value: d } : { error: `「${f.name}」必須是日期，例如 2026-11-05` };
  }
  return { value: String(raw).trim() };
}

// 無法解析時回傳 null
export function parseTags(raw) {
  let list;
  if (raw === null || raw === undefined) list = [];
  else if (Array.isArray(raw)) list = raw;
  else if (typeof raw === 'string') list = raw.split(/[,，、;；\n]/);
  else return null;
  if (list.some((t) => typeof t === 'object' && t !== null)) return null;
  return [...new Set(list.map((t) => String(t ?? '').trim()).filter(Boolean))];
}

// 比對用：全形半形、大小寫視為相同
export function normalizeText(text) {
  return String(text).normalize('NFKC').trim().toLowerCase();
}

export function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fieldValue(f, row) {
  if (f.type === 'tags') return row.tags ?? [];
  if (f.type === 'createdAt') return row.createdAt;
  return row.values[f.id] ?? '';
}

export function fieldText(f, row) {
  const value = fieldValue(f, row);
  if (f.type === 'tags') return value.join('、');
  if (f.type === 'createdAt') return formatDate(value);
  return String(value);
}

// 用來判斷重複的欄位：排在最前面的非系統欄位
export function keyField(fields) {
  return fields.find((f) => !f.system);
}

export function keyOf(f, row) {
  return String(row.values[f.id] ?? '').trim();
}
