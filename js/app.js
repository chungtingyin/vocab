import { newTableView, settingsView } from './fields.js';
import { flashcardPlayView, flashcardSetupView } from './flashcard.js';
import { mainView, rowFormView } from './rows.js';
import { quizPlayView, quizSetupView, recordView, recordsView } from './quiz.js';
import { homeView } from './tables.js';
import { applyStoredTheme, confirmDialog, go, h, takeForcedNavigation } from './ui.js';

const routes = [
  [/^#\/new$/, () => newTableView()],
  [/^#\/table\/(\d+)$/, (id) => mainView(Number(id))],
  [/^#\/table\/(\d+)\/settings$/, (id) => settingsView(Number(id))],
  [/^#\/table\/(\d+)\/flashcard$/, (id) => flashcardSetupView(Number(id))],
  [/^#\/table\/(\d+)\/flashcard\/play$/, (id) => flashcardPlayView(Number(id))],
  [/^#\/table\/(\d+)\/quiz$/, (id) => quizSetupView(Number(id))],
  [/^#\/table\/(\d+)\/quiz\/play$/, (id) => quizPlayView(Number(id))],
  [/^#\/table\/(\d+)\/quiz\/records$/, (id) => recordsView(Number(id))],
  [/^#\/table\/(\d+)\/quiz\/records\/(\d+)$/, (id, recordId) => recordView(Number(id), Number(recordId))],
  [/^#\/table\/(\d+)\/add$/, (id) => rowFormView(Number(id))],
  [/^#\/table\/(\d+)\/row\/(\d+)$/, (id, rowId) => rowFormView(Number(id), Number(rowId))],
];

const root = document.getElementById('app');
let renderToken = 0;

async function render() {
  const token = ++renderToken;
  const hash = location.hash;
  const route = routes.find(([pattern]) => pattern.test(hash));
  try {
    const view = route
      ? await route[1](...hash.match(route[0]).slice(1))
      : await homeView();
    if (token !== renderToken) return;
    if (view === null) {
      go('#/'); // 表格或資料已不存在
      return;
    }
    root.replaceChildren(view);
  } catch (e) {
    console.error(e);
    if (token === renderToken) {
      root.replaceChildren(h('div', { class: 'fatal' }, h('h1', {}, '無法開啟資料'), h('p', {}, String(e.message ?? e))));
    }
  }
}

// 畫面可以設定 view.leaveGuard = { isDirty, title, message, okLabel, onLeave }，
// 瀏覽器的上一頁、下一頁和 App 內的返回鍵都會先問過
const guardOf = () => root.firstElementChild?.leaveGuard;
let currentHash = location.hash;
let leaving = false;
let asking = false;

addEventListener('hashchange', async () => {
  const guard = guardOf();
  if (takeForcedNavigation() || leaving || !guard?.isDirty()) {
    leaving = false;
    currentHash = location.hash;
    render();
    return;
  }
  // 網址已經換了，先放回原本的頁面；確定離開後再退回剛剛要去的那一頁
  history.pushState(null, '', currentHash || '#');
  if (asking) return;
  asking = true;
  const ok = await confirmDialog(guard.title, guard.message, guard.okLabel);
  asking = false;
  if (!ok) return;
  guard.onLeave?.();
  leaving = true;
  history.back();
});

addEventListener('beforeunload', (e) => {
  if (!guardOf()?.isDirty()) return;
  e.preventDefault();
  e.returnValue = '';
});

applyStoredTheme();
render();
