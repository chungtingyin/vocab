const DB_NAME = 'vocab';
let dbPromise;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (e.oldVersion < 1) {
        db.createObjectStore('tables', { keyPath: 'id', autoIncrement: true });
        const rows = db.createObjectStore('rows', { keyPath: 'id', autoIncrement: true });
        rows.createIndex('tableId', 'tableId');
      }
      if (e.oldVersion < 2) {
        const records = db.createObjectStore('quizRecords', { keyPath: 'id', autoIncrement: true });
        records.createIndex('tableId', 'tableId');
      }
    };
    req.onblocked = () => reject(new Error('請關閉其他開著 vocab 的分頁，再重新整理這一頁'));
    req.onsuccess = () => {
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function result(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listTables() {
  const db = await open();
  return result(db.transaction('tables').objectStore('tables').getAll());
}

export async function getTable(id) {
  const db = await open();
  return result(db.transaction('tables').objectStore('tables').get(id));
}

export async function listRows(tableId) {
  const db = await open();
  return result(db.transaction('rows').objectStore('rows').index('tableId').getAll(tableId));
}

export async function getRow(id) {
  const db = await open();
  return result(db.transaction('rows').objectStore('rows').get(id));
}

// 表格和它的資料一起寫入，失敗時兩者都不會留下
export async function createTable(table, rows = [], records = []) {
  const db = await open();
  const tx = db.transaction(['tables', 'rows', 'quizRecords'], 'readwrite');
  const id = await result(tx.objectStore('tables').add(table));
  const store = tx.objectStore('rows');
  for (const row of rows) store.add({ ...row, tableId: id });
  const recordStore = tx.objectStore('quizRecords');
  for (const record of records) recordStore.add({ ...record, tableId: id });
  await done(tx);
  return id;
}

// 同時清掉被刪除欄位的資料
export async function saveTable(table, removedFieldIds = []) {
  const db = await open();
  const tx = db.transaction(['tables', 'rows'], 'readwrite');
  tx.objectStore('tables').put(table);
  if (removedFieldIds.length) {
    const store = tx.objectStore('rows');
    const rows = await result(store.index('tableId').getAll(table.id));
    for (const row of rows) {
      for (const id of removedFieldIds) delete row.values[id];
      store.put(row);
    }
  }
  await done(tx);
}

export async function deleteTable(id) {
  const db = await open();
  const tx = db.transaction(['tables', 'rows', 'quizRecords'], 'readwrite');
  tx.objectStore('tables').delete(id);
  for (const name of ['rows', 'quizRecords']) {
    const store = tx.objectStore(name);
    const keys = await result(store.index('tableId').getAllKeys(id));
    for (const key of keys) store.delete(key);
  }
  await done(tx);
}

export async function listRecords(tableId) {
  const db = await open();
  return result(db.transaction('quizRecords').objectStore('quizRecords').index('tableId').getAll(tableId));
}

export async function getRecord(id) {
  const db = await open();
  return result(db.transaction('quizRecords').objectStore('quizRecords').get(id));
}

export async function addRecord(record) {
  const db = await open();
  return result(db.transaction('quizRecords', 'readwrite').objectStore('quizRecords').add(record));
}

export async function addRecords(tableId, records) {
  const db = await open();
  const tx = db.transaction('quizRecords', 'readwrite');
  for (const record of records) tx.objectStore('quizRecords').add({ ...record, tableId });
  await done(tx);
}

export async function deleteRecord(id) {
  const db = await open();
  const tx = db.transaction('quizRecords', 'readwrite');
  tx.objectStore('quizRecords').delete(id);
  await done(tx);
}

export async function addRows(tableId, rows) {
  const db = await open();
  const tx = db.transaction('rows', 'readwrite');
  for (const row of rows) tx.objectStore('rows').add({ ...row, tableId });
  await done(tx);
}

export async function putRows(rows) {
  const db = await open();
  const tx = db.transaction('rows', 'readwrite');
  for (const row of rows) tx.objectStore('rows').put(row);
  await done(tx);
}

export async function deleteRows(ids) {
  const db = await open();
  const tx = db.transaction('rows', 'readwrite');
  for (const id of ids) tx.objectStore('rows').delete(id);
  await done(tx);
}

