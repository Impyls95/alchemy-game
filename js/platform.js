// Платформенный адаптер. Обычный веб (GitHub Pages и т.п.) работает как раньше;
// на хостинге Яндекс Игр подгружается /sdk.js — SDK обязателен для модерации:
// LoadingAPI.ready(), прогресс игрока через player.setData/getData,
// язык из ysdk.environment.i18n. Локальная проверка ветки: ?mockysdk=1.
// Пикабу Игры: игра остаётся на нашем хостинге, SDK подгружается с games.pikabu.ru,
// облачные сохранения через sdk.storage, готовность — sdk.gameStarted().
// Проверка ветки: ?mockpksdk=1.
import { localBackend, normalize } from './storage.js';

const KEY = 'alchemy.save.v1';

const isYandexHost = () => /yandex/.test(location.hostname);

// Пикабу встраивает игру со своего сайта (iframe) или открывает по ссылке —
// наш origin при этом не меняется, поэтому ориентируемся на окружение,
// а не на hostname. Прямые визиты (поделились ссылкой) остаются веб-веткой.
function looksLikePikabu() {
  try {
    if (/pikabu/.test(location.hostname)) return true;
    if (/pikabu\.ru/.test(document.referrer)) return true;
    const ao = location.ancestorOrigins;
    for (let i = 0; ao && i < ao.length; i++) {
      if (/pikabu\.ru/.test(ao.item(i))) return true;
    }
  } catch { /* ок */ }
  return false;
}

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

// Мок SDK Пикабу: та же форма sdk.storage (get/set/remove/getAll/replaceAll/clear/flush).
function makeMockPkbSdk() {
  const SKEY = 'alchemy.mockpksdk.storage';
  const read = () => { try { return JSON.parse(localStorage.getItem(SKEY) || '{}'); } catch { return {}; } };
  const write = (obj) => { try { localStorage.setItem(SKEY, JSON.stringify(obj)); } catch { /* ок */ } };
  console.info('[alchemy] mock PkbSDK');
  return {
    player: { id: 'mock', name: 'Tester', avatar: '', isAuthorized: false },
    auth: { openAuthDialog: async () => {} },
    storage: {
      get: (key) => read()[key],
      set: (key, value) => { const o = read(); o[key] = value; write(o); },
      remove: (key) => { const o = read(); delete o[key]; write(o); },
      getAll: () => ({ ...read() }),
      replaceAll: (data) => write({ ...data }),
      clear: () => write({}),
      flush: async () => ({ ok: true })
    },
    gameStarted: () => console.info('[alchemy] mock: gameStarted()')
  };
}

export const platform = {
  name: 'web',
  shareAllowed: true,   // на Яндексе и Пикабу кнопку скрываем: внешние ссылки запрещены модерацией
  lang: null,           // язык платформы ('ru'/'en') для новых игроков
  ysdk: null,
  pk: null,
  backend: null,

  signalReady() {
    try {
      this.ysdk?.features?.LoadingAPI?.ready();
      if (this.name === 'pikabu') this.pk?.gameStarted?.();
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

// Облачные сохранения Пикабу: sdk.storage (квота 200 КБ, лимит 100 сохранений
// на сервер за 5 минут). set() применяет изменения локально сразу, на сервер они
// уходят с задержкой или через flush() — поэтому flush делаем только в saveNow
// (уход со вкладки), а рутинные записи идут дебаунсом без форсирования.
function pikabuBackend(sdk) {
  let timer = null;
  let pending = null;
  const mirror = (state) => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* сторонний iframe — ок */ }
  };
  const push = (state) => {
    mirror(state);
    try {
      sdk.storage.set(KEY, state);
    } catch (err) {
      console.warn('[alchemy] Прогресс не сохранён в облаке Пикабу, остался в локальной копии:', err);
    }
  };
  return {
    async load() {
      try {
        const data = sdk.storage.get(KEY);
        if (data && Object.keys(data).length) return normalize(data);
        return normalize({});
      } catch (err) {
        console.warn('[alchemy] Облако Пикабу недоступно, читаю локальную копию:', err);
        return localBackend.load();
      }
    },
    save(state) {
      pending = state;
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        push(pending);
      }, 250);
    },
    saveNow(state) {
      if (timer) { clearTimeout(timer); timer = null; }
      push(state);
      try { sdk.storage.flush()?.catch?.(() => { /* лимит сохранений — ок */ }); } catch { /* ок */ }
    },
    async clear() {
      try { localStorage.removeItem(KEY); } catch { /* ок */ }
      try { sdk.storage.remove(KEY); } catch { /* ок */ }
    }
  };
}

export async function initPlatform() {
  const params = new URLSearchParams(location.search);
  const mockYandex = params.has('mockysdk');
  const mockPikabu = params.has('mockpksdk');
  if (!mockYandex && !mockPikabu && !isYandexHost() && !looksLikePikabu()) return platform;

  try {
    if (mockYandex || isYandexHost()) {
      if (mockYandex) {
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
    } else {
      if (mockPikabu) {
        window.PkbSDK ??= { init: async () => makeMockPkbSdk() };
      } else {
        await withTimeout(loadScript('https://games.pikabu.ru/sdk/sdk.js'), 5000);
      }
      const sdk = await withTimeout(window.PkbSDK.init(), 5000);
      platform.name = 'pikabu';
      platform.pk = sdk;
      platform.shareAllowed = false;
      platform.backend = pikabuBackend(sdk);
    }
  } catch (err) {
    console.warn('[alchemy] SDK платформы недоступен, работаем в веб-режиме:', err);
  }
  return platform;
}
