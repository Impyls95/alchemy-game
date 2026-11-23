// Платформенный адаптер. Обычный веб (GitHub Pages и т.п.) работает как раньше;
// на хостинге Яндекс Игр подгружается /sdk.js — SDK обязателен для модерации:
// LoadingAPI.ready(), прогресс игрока через player.setData/getData,
// язык из ysdk.environment.i18n. Локальная проверка ветки: ?mockysdk=1.
import { localBackend, normalize } from './storage.js';

const KEY = 'alchemy.save.v1';

const isYandexHost = () => /yandex/.test(location.hostname);

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
  ]);
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Не удалось загрузить ${src}`));
    document.head.append(s);
  });
}

// Минимальный мок SDK с тем же контрактом; данные — в отдельном localStorage-ключе.
function makeMockSdk() {
  const PKEY = 'alchemy.mockysdk.player';
  const read = () => { try { return JSON.parse(localStorage.getItem(PKEY) || '{}'); } catch { return {}; } };
  const player = {
    getMode: () => 'lite',
    getData: async () => read(),
    setData: async (data) => { localStorage.setItem(PKEY, JSON.stringify(data)); }
  };
  return {
    environment: { i18n: { lang: 'ru' } },
    features: {
      LoadingAPI: { ready: () => console.info('[alchemy] mock: LoadingAPI.ready()') },
      GameplayAPI: { start: () => {}, stop: () => {} }
    },
    getPlayer: async () => player
  };
}

export const platform = {
  name: 'web',
  shareAllowed: true,   // на Яндексе кнопку скрываем: внешние ссылки запрещены модерацией
  lang: null,           // язык платформы ('ru'/'en') для новых игроков
  ysdk: null,
  backend: null,

  signalReady() {
    try {
      this.ysdk?.features?.LoadingAPI?.ready();
      this.ysdk?.features?.GameplayAPI?.start();
    } catch { /* фичи необязательны */ }
  },

  gameplayStop() {
    try { this.ysdk?.features?.GameplayAPI?.stop(); } catch { /* необязательна */ }
  },

  gameplayStart() {
    try { this.ysdk?.features?.GameplayAPI?.start(); } catch { /* необязательна */ }
  }
};

// Прогресс живёт в player.setData (до 200 КБ на игрока); localStorage — зеркало
// на случай недоступности SDK (в iframe платформы он может быть заблокирован).
function yandexBackend(ysdk) {
  let playerPromise = null;
  const getPlayer = () => {
    playerPromise ??= ysdk.getPlayer();
    return playerPromise;
  };
  const mirror = (state) => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* сторонний iframe — ок */ }
  };
  const push = async (state, flush) => {
    mirror(state);
    try {
      const player = await getPlayer();
      await player.setData(state, flush);
    } catch (err) {
      console.warn('[alchemy] Прогресс не сохранён на платформе, остался в локальной копии:', err);
    }
  };
  let timer = null;
  let pending = null;
  return {
    async load() {
      try {
        const player = await getPlayer();
        const data = await player.getData();
        if (data && Object.keys(data).length) return normalize(data);
        // Новый игрок: стартовый язык — из окружения платформы.
        const seed = platform.lang ? { settings: { lang: platform.lang } } : {};
        return normalize(seed);
      } catch (err) {
        console.warn('[alchemy] Данные платформы недоступны, читаю локальную копию:', err);
        return localBackend.load();
      }
    },
    save(state) {
      pending = state;
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        push(pending, false);
      }, 250);
    },
    saveNow(state) {
      if (timer) { clearTimeout(timer); timer = null; }
      push(state, true);
    },
    async clear() {
      try { localStorage.removeItem(KEY); } catch { /* ок */ }
      try {
        const player = await getPlayer();
        await player.setData({}, true);
      } catch { /* ок */ }
    }
  };
}

export async function initPlatform() {
  const mock = new URLSearchParams(location.search).has('mockysdk');
  if (!mock && !isYandexHost()) return platform;

  try {
    if (mock) {
      window.YaGames ??= { init: async () => makeMockSdk() };
    } else {
      await withTimeout(loadScript('/sdk.js'), 5000);
    }
    const ysdk = await withTimeout(window.YaGames.init(), 5000);
    platform.name = 'yandex';
    platform.ysdk = ysdk;
    platform.lang = ysdk?.environment?.i18n?.lang === 'ru' ? 'ru' : 'en';
    platform.shareAllowed = false;
    platform.backend = yandexBackend(ysdk);
  } catch (err) {
    console.warn('[alchemy] SDK платформы недоступен, работаем в веб-режиме:', err);
  }
  return platform;
}
