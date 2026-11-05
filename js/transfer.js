// JSON 匯入與匯出。檔案裡的屬性名稱一律使用欄位代號，所以改欄位名稱不影響舊檔案

import { coerceValue, fieldValue, formatDate, keyField, keyOf, newId, parseTags, systemFields, validateFields, FIELD_TYPES } from './model.js';

const APP = 'vocab';
const VERSION = 1;

function fileHeader(table, fields) {
  return {
    app: APP,
    version: VERSION,
    title: table.title,
    description: table.description,
    fields: fields.map(({ code, name, type, required, showInList }) => ({ code, name, type, required, showInList })),
  };
}

function exportRow(fields, row) {
  const out = {};
  for (const f of fields) out[f.code] = fieldValue(f, row);
  return out;
}

export function buildTemplate(table) {
  const row = {};
  for (const f of table.fields) {
    if (f.type !== 'createdAt') row[f.code] = f.type === 'tags' ? [] : '';
  }
  return { ...fileHeader(table, table.fields), rows: [row] };
}

export function buildExport(table, rows) {
  return { ...fileHeader(table, table.fields), rows: rows.map((r) => exportRow(table.fields, r)) };
}

export function exportFullTable(table, rows) {
  downloadJson(`${table.title}-${formatDate(new Date())}.json`, buildExport(table, rows));
}

export function exportRecords(title, records) {
  downloadJson(`${title}-測驗紀錄-${formatDate(new Date())}.json`, {
    app: APP,
    type: 'quiz-records',
    version: VERSION,
    title,
    records: records.map(({ id, tableId, ...record }) => record),
  });
}

// 刪除表格前可下載的檔案
export function tableDownloads(table, rows, records) {
  return [
    { label: `完整表格（${rows.length} 筆資料）`, download: () => exportFullTable(table, rows) },
    ...(records.length
      ? [{ label: `測驗紀錄（${records.length} 筆）`, download: () => exportRecords(table.title, records) }]
      : []),
    { label: '欄位格式', download: () => downloadJson(`${table.title}-格式.json`, buildTemplate(table)) },
  ];
}

function isValidQuestion(q, mode) {
  return Array.isArray(q?.front)
    && q.front.every((x) => typeof x?.name === 'string' && typeof x?.value === 'string')
    && typeof q.answer === 'string'
    && Array.isArray(q.accepted)
    && (mode !== 'choice' || Array.isArray(q.options));
}

// 內容不完整的紀錄會略過
export function parseRecords(payload) {
  const items = Array.isArray(payload?.records) ? payload.records : [];
  const records = [];
  for (const item of items) {
    const valid = typeof item?.name === 'string'
      && ['choice', 'fill'].includes(item.mode)
      && !Number.isNaN(new Date(item.finishedAt).getTime())
      && Array.isArray(item.questions)
      && item.questions.length > 0
      && item.questions.every((q) => isValidQuestion(q, item.mode));
    if (!valid) continue;
    const questions = item.questions.map((q) => ({
      ...q,
      rowId: null, // 資料列在新表格裡的編號不同
      options: q.options ?? null,
      userAnswer: String(q.userAnswer ?? ''),
      correct: Boolean(q.correct),
    }));
    records.push({
      name: item.name,
      finishedAt: item.finishedAt,
      durationSeconds: Number(item.durationSeconds) || 0,
      mode: item.mode,
      order: item.order === 'sorted' ? 'sorted' : 'random',
      tags: Array.isArray(item.tags) ? item.tags : [],
      score: questions.filter((q) => q.correct).length,
      total: questions.length,
      questions,
    });
  }
  return { records, skipped: items.length - records.length };
}

export function parseRows(fields, payload, existingRows) {
  const items = Array.isArray(payload) ? payload : payload?.rows;
  if (!Array.isArray(items)) throw new Error('找不到資料：檔案內容必須是陣列，或含有 rows 的物件');

  const key = keyField(fields);
  const seen = new Set(existingRows.map((r) => keyOf(key, r)));
  const codes = new Set(fields.map((f) => f.code));
  const now = new Date().toISOString();
  const report = { rows: [], skipped: 0, errors: [], unknown: new Set() };

  items.forEach((item, i) => {
    const where = `第 ${i + 1} 筆`;
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      report.errors.push(`${where}：不是物件`);
      return;
    }
    for (const k of Object.keys(item)) if (!codes.has(k)) report.unknown.add(k);

    const row = { values: {}, tags: [], createdAt: now };
    const problems = [];
    let blank = true;
    for (const f of fields) {
      const raw = Object.hasOwn(item, f.code) ? item[f.code] : undefined;
      if (f.type === 'tags') {
        const tags = parseTags(raw);
        if (tags === null) problems.push(`「${f.name}」的格式不正確`);
        else {
          row.tags = tags;
          if (tags.length) blank = false;
        }
      } else if (f.type === 'createdAt') {
        if (raw && !Number.isNaN(new Date(raw).getTime())) row.createdAt = new Date(raw).toISOString();
      } else {
        const { value, error } = coerceValue(f, raw);
        if (raw !== null && raw !== undefined && String(raw).trim() !== '') blank = false;
        if (error) problems.push(error);
        else if (value !== '') row.values[f.id] = value;
      }
    }
    if (blank) return; // 欄位範本裡的空白範例
    if (problems.length) {
      report.errors.push(`${where}：${problems.join('、')}`);
      return;
    }
    const k = keyOf(key, row);
    if (k && seen.has(k)) {
      report.skipped += 1;
      return;
    }
    if (k) seen.add(k);
    report.rows.push(row);
  });
  report.unknown = [...report.unknown];
  return report;
}

// 從匯出檔還原一張新表格
export function parseTableFile(payload) {
  if (!Array.isArray(payload?.fields)) {
    throw new Error('這個檔案沒有欄位設定。如果只有資料，請先建立表格，再到表格的 + 頁面匯入');
  }
  const title = String(payload.title ?? '').trim();
  if (!title) throw new Error('檔案缺少標題');

  const system = systemFields();
  const fields = payload.fields.map((f) => {
    const sys = system.find((s) => s.type === f?.type);
    if (sys) return { ...sys, name: String(f.name ?? sys.name), showInList: Boolean(f.showInList) };
    return {
      id: newId(),
      code: String(f?.code ?? ''),
      name: String(f?.name ?? ''),
      type: Object.hasOwn(FIELD_TYPES, f?.type) ? f.type : 'text',
      required: Boolean(f?.required),
      showInList: f?.showInList !== false,
      system: false,
    };
  });
  for (const sys of system) if (!fields.some((f) => f.type === sys.type)) fields.push(sys);

  const errors = validateFields(fields);
  if (Object.keys(errors).length) throw new Error('檔案的欄位設定有誤：欄位名稱或代號空白、重複或含有不支援的字元');
  if (!keyField(fields)) throw new Error('檔案至少要有一個欄位');
  if (!fields.some((f) => f.showInList)) fields[0].showInList = true;

  return { title, description: String(payload.description ?? '').trim(), fields };
}

export async function readJsonFile(file) {
  const text = await file.text();
  try {
    return JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    throw new Error('這不是有效的 JSON 檔');
  }
}

export function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.replace(/[\\/:*?"<>|]/g, '_');
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
