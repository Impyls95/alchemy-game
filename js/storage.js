// Хранилище прогресса: подключаемый backend. По умолчанию localStorage;
// платформенный backend (Яндекс Игры / player.setData) подключается через setBackend.
const KEY = 'alchemy.save.v1';

const DEFAULTS = () => ({
  discovered: [],        // ids открытых элементов
  tiles: [],             // { uid, el, x, y } — позиции плиток на поле (px)
  fresh: [],             // элементы с непогашенным бейджем NEW
  settings: { theme: 'dark', lang: 'ru', sound: true, sort: 'default', gesturesSeen: false },
  hintAt: 0,             // timestamp последней подсказки (кулдаун)
  crafts: 0,             // всего успешных смешиваний (для достижений)
  lastDaily: '',         // день (YYYY-MM-DD), когда последний раз засчитан рецепт дня
  dailyStreak: 0,        // серия дней с выполненным рецептом дня
  welcomed: false
});

// Приводим загруженные данные к валидному состоянию (защита от повреждённых данных).
export function normalize(data) {
  if (!data || typeof data !== 'object') return DEFAULTS();
  return {
    ...DEFAULTS(),
    ...data,
    discovered: Array.isArray(data.discovered) ? data.discovered.filter((x) => typeof x === 'string') : [],
    tiles: Array.isArray(data.tiles) ? data.tiles.filter((t) => t && typeof t.el === 'string') : [],
    fresh: Array.isArray(data.fresh) ? data.fresh : [],
    crafts: Number.isFinite(data.crafts) ? Math.max(0, Math.floor(data.crafts)) : 0,
    lastDaily: typeof data.lastDaily === 'string' ? data.lastDaily : '',
    dailyStreak: Number.isFinite(data.dailyStreak) ? Math.max(0, Math.floor(data.dailyStreak)) : 0,
    settings: { ...DEFAULTS().settings, ...(data.settings && typeof data.settings === 'object' ? data.settings : {}) }
  };
}

let timer = null;
let pending = null;

// Дебаунс записи: drag генерирует много событий, пишем не чаще раза в 250 мс.
export const localBackend = {
  async load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return DEFAULTS();
      return normalize(JSON.parse(raw));
    } catch (err) {
      console.warn('[alchemy] Не удалось прочитать сохранение, начинаем заново:', err);
      return DEFAULTS();
    }
  },
  save(state) {
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
  },
  saveNow(state) {
    if (timer) { clearTimeout(timer); timer = null; }
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (err) {
      console.warn('[alchemy] Не удалось сохранить прогресс:', err);
    }
  },
  clear() {
    try { localStorage.removeItem(KEY); } catch { /* приватный режим — ок */ }
  }
};

let backend = localBackend;

export function setBackend(b) {
  backend = b ?? localBackend;
}

export async function load() {
  return backend.load();
}

export function save(state) {
  backend.save(state);
}

export function saveNow(state) {
  backend.saveNow(state);
}

export function clear() {
  backend.clear?.();
}
