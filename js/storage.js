// Обёртка над localStorage: версионированный ключ, защита от повреждённых данных.
const KEY = 'alchemy.save.v1';

const DEFAULTS = () => ({
  discovered: [],        // ids открытых элементов
  tiles: [],             // { uid, el, x, y } — позиции плиток на поле (px)
  fresh: [],             // элементы с непогашенным бейджем NEW
  settings: { theme: 'dark', lang: 'ru', sound: true, sort: 'default', gesturesSeen: false },
  hintAt: 0,             // timestamp последней подсказки (кулдаун)
  welcomed: false
});

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS();
    const data = JSON.parse(raw);
    const base = DEFAULTS();
    return {
      ...base,
      ...data,
      discovered: Array.isArray(data.discovered) ? data.discovered.filter((x) => typeof x === 'string') : [],
      tiles: Array.isArray(data.tiles) ? data.tiles.filter((t) => t && typeof t.el === 'string') : [],
      fresh: Array.isArray(data.fresh) ? data.fresh : [],
      settings: { ...base.settings, ...(data.settings ?? {}) }
    };
  } catch (err) {
    console.warn('[alchemy] Не удалось прочитать сохранение, начинаем заново:', err);
    return DEFAULTS();
  }
}

let timer = null;
let pending = null;

// Дебаунс записи: drag генерирует много событий, пишем не чаще раза в 250 мс.
export function save(state) {
  pending = state;
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    try {
      localStorage.setItem(KEY, JSON.stringify(pending));
    } catch (err) {
      console.warn('[alchemy] Не удалось сохранить прогресс:', err);
    }
  }, 250);
}

export function saveNow(state) {
  if (timer) { clearTimeout(timer); timer = null; }
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('[alchemy] Не удалось сохранить прогресс:', err);
  }
}

export function clear() {
  try { localStorage.removeItem(KEY); } catch { /* приватный режим — ок */ }
}