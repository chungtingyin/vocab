import { newTableView, settingsView } from './fields.js';
import { flashcardPlayView, flashcardSetupView } from './flashcard.js';
import { mainView, rowFormView } from './rows.js';
import { quizPlayView, quizSetupView, recordView, recordsView } from './quiz.js';
import { homeView } from './tables.js';
import { applyStoredTheme, go, h } from './ui.js';

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

applyStoredTheme();
addEventListener('hashchange', render);
render();
