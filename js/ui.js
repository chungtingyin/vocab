// DOM 工具、1-bit 圖示、對話框

export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...kids.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));
  return el;
}

export function go(hash) {
  location.hash = hash;
}

const SVG = 'http://www.w3.org/2000/svg';

// 把點陣字串畫成 SVG，顏色跟著 currentColor，所以深色模式不用另外處理
export function bitmap(rows, size) {
  const w = Math.max(...rows.map((r) => r.length));
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${rows.length}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'bitmap');
  if (size) {
    svg.setAttribute('width', size);
    svg.setAttribute('height', Math.round((size * rows.length) / w));
  }
  rows.forEach((row, y) => {
    for (const m of row.matchAll(/#+/g)) {
      const rect = document.createElementNS(SVG, 'rect');
      rect.setAttribute('x', m.index);
      rect.setAttribute('y', y);
      rect.setAttribute('width', m[0].length);
      rect.setAttribute('height', 1);
      svg.append(rect);
    }
  });
  return svg;
}

const ICONS = {
  plus: ['.........', '...###...', '...###...', '.#######.', '.#######.', '.#######.', '...###...', '...###...', '.........'],
  star: ['....#....', '.#..#..#.', '..#.#.#..', '...###...', '.#######.', '...###...', '..#.#.#..', '.#..#..#.', '....#....'],
  f: ['.#######.', '.#######.', '.##......', '.##......', '.#####...', '.#####...', '.##......', '.##......', '.##......'],
  t: ['.#######.', '.#######.', '...###...', '...###...', '...###...', '...###...', '...###...', '...###...', '...###...'],
  eye: ['...........', '...#####...', '.##.....##.', '#...###...#', '#...###...#', '#...###...#', '.##.....##.', '...#####...', '...........'],
  eyeOff: ['...........', '...........', '...........', '#.........#', '.##.....##.', '...#####...', '..#..#..#..', '.#...#...#.', '...........'],
  grip: ['##.##.##', '##.##.##', '........', '##.##.##', '##.##.##', '........', '##.##.##', '##.##.##'],
  back: ['....#....', '...##....', '..###....', '.########', '#########', '.########', '..###....', '...##....', '....#....'],
  forward: ['....#....', '....##...', '....###..', '########.', '#########', '########.', '....###..', '....##...', '....#....'],
  search: ['..####...', '.#....#..', '#......#.', '#......#.', '#......#.', '.#....#..', '..####.#.', '.......##', '........#'],
  close: ['##.....##', '###...###', '.###.###.', '..#####..', '...###...', '..#####..', '.###.###.', '###...###', '##.....##'],
  check: ['........#', '.......##', '......##.', '#....##..', '##..##...', '.####....', '..##.....'],
  pencil: ['.......##.', '......####', '.....#.###', '....#...#.', '...#...#..', '..#...#...', '.#...#....', '.##.#.....', '.###......', '####......'],
  floppy: ['##########..', '#.#....#.##.', '#.#..#.#.###', '#.#..#.#...#', '#.#....#...#', '#..####....#', '#..........#', '#.########.#', '#.#......#.#', '#.#.####.#.#', '#.#......#.#', '############'],
  theme: ['..#####..', '.#..####.', '#...#####', '#...#####', '#...#####', '#...#####', '#...#####', '.#..####.', '..#####..'],
  up: ['..#..', '.###.', '#####'],
  down: ['#####', '.###.', '..#..'],
};

export function icon(name, size = 18) {
  return bitmap(ICONS[name], size);
}

const LOGO = [
  '#...#..###...###...###..####.',
  '#...#.#...#.#...#.#...#.#...#',
  '#...#.#...#.#.....#...#.#...#',
  '#...#.#...#.#.....#####.####.',
  '.#.#..#...#.#.....#...#.#...#',
  '.#.#..#...#.#...#.#...#.#...#',
  '..#....###...###..#...#.####.',
];

export function logo(size) {
  return bitmap(LOGO, size);
}

// 將任何語言的文字先畫到小畫布，再二值化成點陣，不必內嵌龐大的像素字型
const GLYPH_SIZE = 24;
const glyphCache = new Map();

export function pixelGlyph(char, size) {
  if (!glyphCache.has(char)) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = GLYPH_SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.font = `700 ${GLYPH_SIZE - 3}px -apple-system, "PingFang TC", "Hiragino Sans", "Noto Sans TC", "Noto Sans JP", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(char, GLYPH_SIZE / 2, GLYPH_SIZE / 2 + 1);
    const { data } = ctx.getImageData(0, 0, GLYPH_SIZE, GLYPH_SIZE);
    const rows = [];
    for (let y = 0; y < GLYPH_SIZE; y += 1) {
      let row = '';
      for (let x = 0; x < GLYPH_SIZE; x += 1) row += data[(y * GLYPH_SIZE + x) * 4 + 3] > 100 ? '#' : '.';
      rows.push(row);
    }
    glyphCache.set(char, rows);
  }
  return bitmap(glyphCache.get(char), size);
}

export function firstChar(text) {
  return Array.from(String(text).trim())[0] ?? '?';
}

let toastTimer;
export function toast(message) {
  document.querySelector('.toast')?.remove();
  const el = h('div', { class: 'toast', role: 'status' }, message);
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 2600);
}

// actions: [{ label, value, primary }]，關閉時回傳 undefined
export function openDialog({ title, body = [], actions = [{ label: '確定', value: true, primary: true }] }) {
  return new Promise((resolve) => {
    const dialog = h('dialog', { class: 'dialog' },
      h('h2', {}, title),
      h('div', { class: 'dialog-body' }, body),
      h('div', { class: 'dialog-actions' }, actions.map((a) => h('button', {
        type: 'button',
        class: a.primary ? 'btn btn-primary' : 'btn',
        onclick: () => dialog.close(String(actions.indexOf(a))),
      }, a.label))));
    dialog.addEventListener('close', () => {
      const action = actions[Number(dialog.returnValue)];
      dialog.remove();
      resolve(dialog.returnValue === '' ? undefined : action?.value);
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}

export async function confirmDialog(title, message, okLabel = '確定') {
  const result = await openDialog({
    title,
    body: [h('p', {}, message)],
    actions: [{ label: '取消', value: false }, { label: okLabel, value: true, primary: true }],
  });
  return result === true;
}

// 開啟系統的選檔畫面，回傳選到的檔案
export function pickFile(accept = '.json,application/json') {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, onchange: () => resolve(input.files[0]) });
    input.click();
  });
}

const THEME_KEY = 'vocab-theme';

export function applyStoredTheme() {
  try {
    const theme = localStorage.getItem(THEME_KEY);
    if (theme) document.documentElement.dataset.theme = theme;
  } catch { /* 無法使用 localStorage 時跟隨手機設定 */ }
}

export function toggleTheme() {
  const root = document.documentElement;
  const isDark = root.dataset.theme
    ? root.dataset.theme === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = isDark ? 'light' : 'dark';
  try {
    localStorage.setItem(THEME_KEY, root.dataset.theme);
  } catch { /* 只影響這次使用 */ }
}

export function topbar(title, onBack, right = null) {
  return h('header', { class: 'topbar' },
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': '返回', onclick: onBack }, icon('back')),
    h('h1', {}, title),
    right);
}

// 左右滑動換張；onSwipe(1) 是下一張，onSwipe(-1) 是上一張
export function attachSwipe(el, { onSwipe, onTap }) {
  let start = null;
  let swiping = false;
  let suppressClick = false;

  // pan-y 會讓斜斜的滑動被瀏覽器當成上下捲動而取消；沒東西可捲時就把手勢全交給滑動。
  // 外層容器會捲（測驗）就一律保留上下捲動，因為外層內容變動時這裡不會知道
  const scrolls = (node) => /auto|scroll/.test(getComputedStyle(node).overflowY);
  const canScroll = () => {
    if (scrolls(el) && el.scrollHeight > el.clientHeight) return true;
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
      if (scrolls(node)) return true;
    }
    return false;
  };
  const fit = () => { el.style.touchAction = canScroll() ? '' : 'none'; };
  new ResizeObserver(fit).observe(el);
  new MutationObserver(fit).observe(el, { childList: true, subtree: true });

  el.addEventListener('pointerdown', (e) => {
    start = { x: e.clientX, y: e.clientY };
    swiping = false;
    suppressClick = false; // 觸控滑動後不一定會有 click，不能留到下一次點擊
  });
  el.addEventListener('pointermove', (e) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    if (!swiping && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(e.clientY - start.y)) {
      swiping = true;
      el.setPointerCapture(e.pointerId);
    }
    if (swiping) el.style.transform = `translateX(${dx}px)`;
  });
  el.addEventListener('pointerup', (e) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    start = null;
    if (!swiping) return;
    suppressClick = true;
    el.style.transform = '';
    if (Math.abs(dx) > 60) onSwipe(dx < 0 ? 1 : -1);
  });
  el.addEventListener('pointercancel', () => {
    start = null;
    swiping = false;
    el.style.transform = '';
  });
  if (onTap) {
    el.addEventListener('click', () => {
      if (suppressClick) suppressClick = false;
      else onTap();
    });
  }
}

// 回傳是否要刪除。files: [{ label, download }]
export async function askDeleteWithDownloads(title, message, files) {
  const downloaded = new Set();
  for (;;) {
    const choice = await openDialog({
      title,
      body: [
        h('p', {}, message),
        h('ul', { class: 'download-list' }, files.map((file) => {
          const button = h('button', {
            type: 'button',
            class: 'btn btn-small',
            onclick: () => {
              file.download();
              downloaded.add(file);
              button.textContent = '再次下載';
            },
          }, downloaded.has(file) ? '再次下載' : '下載');
          return h('li', {}, h('span', {}, file.label), button);
        })),
      ],
      actions: [
        { label: '取消', value: false },
        { label: '刪除', value: true, primary: true },
      ],
    });
    if (choice !== true) return false;

    const confirmed = await openDialog({
      title: '確認已匯出',
      body: [h('p', {}, '請確認所有檔案都已下載完成，再刪除。')],
      actions: [
        { label: '先不刪除', value: false },
        { label: '刪除', value: true, primary: true },
      ],
    });
    if (confirmed === true) return true;
  }
}
