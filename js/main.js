// Точка входа: состояние, палитра, шапка, модалки, подсказки, сохранение.
import { load, save, saveNow, clear as clearStorage, setBackend, localBackend } from './storage.js';
import { initPlatform, platform } from './platform.js';
import { loadRecipes } from './recipes.js';
import { setLang, getLang, t } from './i18n.js';
import { getMeta, getName } from './elements.js';
import { Field, Sound, hueFor } from './game.js';

const $ = (id) => document.getElementById(id);
const HINT_COOLDOWN_MS = 45_000;

async function boot() {
  const book = await loadRecipes();
  await initPlatform();
  setBackend(platform.backend ?? localBackend);
  const state = await load();
  const sound = new Sound(state.settings.sound);

  // Базовые элементы всегда открыты.
  const discovered = new Set(state.discovered.filter((id) => book.elements.has(id)));
  for (const id of book.base) discovered.add(id);
  state.discovered = [...discovered];
  const fresh = new Set(state.fresh.filter((id) => discovered.has(id)));

  /* ---------- DOM ---------- */
  const fieldEl = $('field');
  const paletteEl = $('palette');
  const paletteGrid = $('paletteGrid');
  const searchEl = $('search');
  const counterEl = $('counter');
  const progressFill = $('progressFill');
  const paletteCount = $('paletteCount');
  const toastsEl = $('toasts');

  // Undo слияния: снимок поля делается перед слиянием; тост живёт,
  // пока не произошло ни одного изменения поля после слияния.
  let fieldVersion = 0;
  let undoToast = null;
  let undoSnapshot = null;

  function onFieldChange() {
    fieldVersion++;
    if (undoToast) { undoToast.remove(); undoToast = null; undoSnapshot = null; }
    persist();
  }

  const field = new Field(fieldEl, book, {
    paletteEl,
    sound,
    onChange: onFieldChange,
    onDiscover: handleDiscover,
    onMerged: handleMerged
  });

  /* ---------- сохранение ---------- */
  function persist() {
    state.discovered = [...discovered];
    state.fresh = [...fresh];
    state.tiles = field.serialize();
    save(state);
  }

  /* ---------- тосты ---------- */
  function toast(msg, kind = '', life = 3000) {
    const node = document.createElement('div');
    node.className = `toast ${kind}`.trim();
    node.style.setProperty('--life', `${life}ms`);
    node.textContent = msg;
    node.addEventListener('animationend', (e) => {
      if (e.animationName === 'toast-out') node.remove();
    });
    toastsEl.appendChild(node);
    setTimeout(() => node.remove(), life + 500);
  }

  // Тост с кнопкой-действием (используется для undo слияния).
  function actionToast(msg, actionLabel, onAction, life = 6000) {
    const node = document.createElement('div');
    node.className = 'toast action';
    node.style.setProperty('--life', `${life}ms`);
    const text = document.createElement('span');
    text.textContent = msg;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-btn';
    btn.textContent = actionLabel;
    btn.addEventListener('click', () => {
      node.remove();
      onAction();
    });
    node.append(text, btn);
    node.addEventListener('animationend', (e) => {
      if (e.animationName === 'toast-out') node.remove();
    });
    toastsEl.appendChild(node);
    setTimeout(() => node.remove(), life + 500);
    return node;
  }

  /* ---------- счётчик и прогресс ---------- */
  function eraIndex() {
    const f = discovered.size / book.total;
    return f >= 0.9 ? 4 : f >= 0.65 ? 3 : f >= 0.4 ? 2 : f >= 0.15 ? 1 : 0;
  }

  function updateCounter() {
    counterEl.textContent = `${discovered.size} / ${book.total}`;
    progressFill.style.width = `${(discovered.size / book.total) * 100}%`;
    paletteCount.textContent = `${discovered.size}`;
    $('eraChip').textContent = t(`era${eraIndex()}`);
  }

  /* ---------- палитра ---------- */
  function renderPalette() {
    const query = searchEl.value.trim().toLowerCase();
    const lang = getLang();
    const ids = [...discovered];
    if (state.settings.sort === 'alpha') {
      ids.sort((a, b) => getName(a, lang).localeCompare(getName(b, lang), undefined, { sensitivity: 'base' }));
    } else if (state.settings.sort === 'recent') {
      ids.reverse(); // новинки сверху
    }
    const frag = document.createDocumentFragment();
    let shown = 0;
    for (const id of ids) {
      const ruName = id.toLowerCase();
      const enName = (getMeta(id).en ?? '').toLowerCase();
      if (query && !ruName.includes(query) && !enName.includes(query)) continue;
      shown++;
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'palette-item';
      if (fresh.has(id)) item.classList.add('is-new');
      item.dataset.el = id;
      item.style.setProperty('--h', hueFor(id).toFixed(1));
      const icon = document.createElement('span');
      icon.className = 'pi-icon';
      icon.textContent = getMeta(id).icon;
      const name = document.createElement('span');
      name.className = 'pi-name';
      name.textContent = getName(id, lang);
      item.append(icon, name);
      if (fresh.has(id)) {
        const badge = document.createElement('span');
        badge.className = 'badge-new';
        badge.textContent = t('newBadge');
        item.appendChild(badge);
      }
      frag.appendChild(item);
    }
    paletteGrid.replaceChildren(frag);
    $('paletteEmpty').hidden = shown > 0;
  }

  function markUsed(id) {
    if (!fresh.delete(id)) return;
    const item = paletteGrid.querySelector(`[data-el="${CSS.escape(id)}"]`);
    item?.classList.remove('is-new');
    item?.querySelector('.badge-new')?.remove();
    persist();
  }

  /* ---------- открытие нового элемента ---------- */
  let discoveryTimer = null;
  function handleDiscover(id) {
    if (discovered.has(id)) return;
    discovered.add(id);
    fresh.add(id);
    updateCounter();
    renderPalette();
    persist();
    sound.discover();

    $('discoveryIcon').textContent = getMeta(id).icon;
    $('discoveryName').textContent = getName(id, getLang());
    const banner = $('discovery');
    banner.hidden = false;
    const card = banner.firstElementChild;
    card.style.animation = 'none';
    void card.offsetWidth; // перезапуск анимации
    card.style.animation = '';
    clearTimeout(discoveryTimer);
    discoveryTimer = setTimeout(() => { banner.hidden = true; }, 2400);

    // Под-scroll палитры к новинке, чтобы бейдж NEW был виден.
    paletteGrid.querySelector(`[data-el="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

    // Веха прогресса: каждые 10 открытий — праздничный всплеск в центре поля.
    if (discovered.size % 10 === 0 && discovered.size < book.total) {
      toast(t('milestone', { n: discovered.size }), 'hint', 4000);
      field.burst(fieldEl.clientWidth / 2, fieldEl.clientHeight / 2);
    }
    if (discovered.size === book.total) toast(t('allDone'), 'hint', 6000);
  }

  /* ---------- undo последнего слияния ---------- */
  function handleMerged(result, snapshot) {
    undoSnapshot = snapshot;
    if (undoToast) { undoToast.remove(); undoToast = null; }
    undoToast = actionToast(
      `${t('merged')}: ${getMeta(result).icon} ${getName(result, getLang())}`,
      t('undo'),
      () => {
        const snap = undoSnapshot;
        undoToast = null;
        undoSnapshot = null;
        field.restoreSnapshot(snap); // открытый элемент остаётся открытым — откатываются только плитки
        sound.remove();
      }
    );
  }

  /* ---------- перетаскивание из палитры на поле ----------
     Мышь: drag сразу. Тач: свайп скроллит палитру (touch-action: pan-y),
     короткое нажатие — тап-добавление, удержание 250 мс — drag. */
  let palDrag = null;
  let palRaf = 0;

  function activatePalDrag() {
    const d = palDrag;
    if (!d || d.active) return;
    d.active = true;
    const ghost = field.buildNode(d.id);
    ghost.classList.add('drag-ghost');
    ghost.style.left = `${d.x}px`;
    ghost.style.top = `${d.y}px`;
    document.body.appendChild(ghost);
    d.ghost = ghost;
    sound.pickup();
    if (navigator.vibrate && navigator.userActivation?.hasBeenActive) {
      try { navigator.vibrate(10); } catch { /* вибрация недоступна */ }
    }
  }

  paletteGrid.addEventListener('pointerdown', (e) => {
    const item = e.target.closest('.palette-item');
    if (!item || palDrag || e.button > 0) return;
    try { item.setPointerCapture(e.pointerId); } catch { /* синтетический pointer */ }
    palDrag = {
      id: item.dataset.el,
      pointerId: e.pointerId,
      ghost: null,
      active: false,
      x: e.clientX, y: e.clientY,
      startX: e.clientX, startY: e.clientY,
      moved: false,
      timer: 0
    };
    if (e.pointerType === 'mouse') {
      e.preventDefault();
      activatePalDrag();
    } else {
      palDrag.timer = setTimeout(activatePalDrag, 250);
    }
  });

  paletteGrid.addEventListener('pointermove', (e) => {
    const d = palDrag;
    if (!d || e.pointerId !== d.pointerId) return;
    d.x = e.clientX;
    d.y = e.clientY;
    if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 8) {
      d.moved = true;
      if (!d.active) { clearTimeout(d.timer); return; } // началось нативное скроллирование
    }
    if (!d.active) return;
    if (!palRaf) {
      palRaf = requestAnimationFrame(() => {
        palRaf = 0;
        if (!palDrag?.ghost) return;
        palDrag.ghost.style.left = `${palDrag.x}px`;
        palDrag.ghost.style.top = `${palDrag.y}px`;
      });
    }
  });

  // Пока drag активен, гасим нативный скролл палитры на тач-устройствах.
  paletteGrid.addEventListener('touchmove', (e) => {
    if (palDrag?.active) e.preventDefault();
  }, { passive: false });

  paletteGrid.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.palette-item')) e.preventDefault();
  });

  function finishPaletteDrag(e, cancelled = false) {
    const d = palDrag;
    if (!d || e.pointerId !== d.pointerId) return;
    clearTimeout(d.timer);
    if (palRaf) { cancelAnimationFrame(palRaf); palRaf = 0; }
    palDrag = null;
    d.ghost?.remove();
    if (cancelled) return;
    const rect = fieldEl.getBoundingClientRect();
    const s = field.tileSize;
    const inside = d.x >= rect.left && d.x <= rect.right && d.y >= rect.top && d.y <= rect.bottom;
    if (d.active && inside) {
      field.spawn(d.id, d.x - rect.left - s / 2, d.y - rect.top - s / 2);
      markUsed(d.id);
    } else if (!d.moved) {
      // Короткий тап/клик: элемент появляется в случайном свободном месте поля.
      const x = 10 + Math.random() * Math.max(20, fieldEl.clientWidth - s - 20);
      const y = 10 + Math.random() * Math.max(20, fieldEl.clientHeight - s - 20);
      field.spawn(d.id, x, y);
      markUsed(d.id);
    }
  }

  paletteGrid.addEventListener('pointerup', (e) => finishPaletteDrag(e));
  paletteGrid.addEventListener('pointercancel', (e) => finishPaletteDrag(e, true));

  // Клавиатура: Enter/Space на кнопке палитры (detail === 0 — не мышиный клик).
  paletteGrid.addEventListener('click', (e) => {
    if (e.detail !== 0) return;
    const item = e.target.closest('.palette-item');
    if (!item) return;
    const s = field.tileSize;
    field.spawn(item.dataset.el,
      10 + Math.random() * Math.max(20, fieldEl.clientWidth - s - 20),
      10 + Math.random() * Math.max(20, fieldEl.clientHeight - s - 20));
    markUsed(item.dataset.el);
  });

  searchEl.addEventListener('input', renderPalette);

  /* ---------- подсказка с кулдауном ---------- */
  const btnHint = $('btnHint');
  const hintLabel = btnHint.querySelector('.btn-label');

  function refreshHintButton() {
    const left = Math.ceil((state.hintAt + HINT_COOLDOWN_MS - Date.now()) / 1000);
    if (left > 0) {
      btnHint.disabled = true;
      if (hintLabel) hintLabel.textContent = t('hintWait', { s: left });
      btnHint.title = t('hintWait', { s: left });
    } else {
      btnHint.disabled = false;
      if (hintLabel) hintLabel.textContent = t('hint');
      btnHint.title = t('hint');
    }
  }

  btnHint.addEventListener('click', () => {
    if (Date.now() - state.hintAt < HINT_COOLDOWN_MS) return;
    const r = book.hint(discovered);
    if (!r) {
      toast(t('hintNone'), 'hint', 4500);
      return;
    }
    state.hintAt = Date.now();
    persist();
    refreshHintButton();
    const lang = getLang();
    toast(`${t('hintTry')}: ${getMeta(r.a).icon} ${getName(r.a, lang)} + ${getMeta(r.b).icon} ${getName(r.b, lang)}`, 'hint', 6000);
  });

  setInterval(refreshHintButton, 1000);

  /* ---------- шаринг прогресса ---------- */
  // На платформах с запретом внешних ссылок (Яндекс Игры) кнопка скрыта.
  if (!platform.shareAllowed) $('btnShare').hidden = true;
  $('btnShare').addEventListener('click', async () => {
    const recent = [...discovered].slice(-3).reverse()
      .map((id) => `${getMeta(id).icon} ${getName(id, getLang())}`)
      .join(', ');
    const text = t('shareText', {
      n: discovered.size,
      m: book.total,
      era: t(`era${eraIndex()}`),
      recent,
      url: location.origin + location.pathname
    });
    try {
      if (navigator.share) {
        await navigator.share({ title: t('title'), text });
        return;
      }
      await navigator.clipboard.writeText(text);
      toast(t('shareCopied'), 'hint', 2500);
    } catch (err) {
      if (err?.name === 'AbortError') return; // пользователь отменил системный диалог
      toast(text, '', 6000);
    }
  });

  /* ---------- сортировка палитры ---------- */
  const SORTS = [
    { id: 'default', icon: '📜', key: 'sortAll' },
    { id: 'recent', icon: '🆕', key: 'sortNew' },
    { id: 'alpha', icon: '🔤', key: 'sortAz' }
  ];
  const btnSort = $('btnSort');

  function applySortBtn() {
    const s = SORTS.find((x) => x.id === state.settings.sort) ?? SORTS[0];
    btnSort.textContent = `${s.icon} ${t(s.key)}`;
    btnSort.title = `${t('sort')}: ${t(s.key)}`;
  }

  btnSort.addEventListener('click', () => {
    const i = SORTS.findIndex((x) => x.id === state.settings.sort);
    state.settings.sort = SORTS[(i + 1) % SORTS.length].id;
    applySortBtn();
    renderPalette();
    persist();
    sound.pickup();
  });

  /* ---------- тема / язык / звук ---------- */
  const btnTheme = $('btnTheme');
  const btnSound = $('btnSound');
  const btnLang = $('btnLang');

  function applyTheme() {
    document.documentElement.dataset.theme = state.settings.theme;
    btnTheme.textContent = state.settings.theme === 'dark' ? '🌙' : '☀️';
  }

  function applySound() {
    sound.enabled = state.settings.sound;
    btnSound.textContent = sound.enabled ? '🔊' : '🔇';
    btnSound.title = t(sound.enabled ? 'soundOn' : 'soundOff');
  }

  function applyLang() {
    setLang(state.settings.lang);
    document.title = `${t('title')} — ${t('tagline')}`;
    renderPalette();
    field.refreshNames();
    refreshHintButton();
    applySortBtn();
    if (!bookModal.hidden) renderBook();
    applySound();
  }

  btnTheme.addEventListener('click', () => {
    state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark';
    applyTheme();
    persist();
  });

  btnSound.addEventListener('click', () => {
    state.settings.sound = !state.settings.sound;
    applySound();
    if (sound.enabled) sound.pop();
    persist();
  });

  btnLang.addEventListener('click', () => {
    state.settings.lang = getLang() === 'ru' ? 'en' : 'ru';
    applyLang();
    persist();
  });

  /* ---------- модалки ---------- */
  const welcomeModal = $('welcomeModal');
  const resetModal = $('resetModal');
  const bookModal = $('bookModal');
  const gestureModal = $('gestureModal');

  const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

  function maybeShowGestures() {
    if (isTouch && !state.settings.gesturesSeen) gestureModal.hidden = false;
  }

  $('btnStart').addEventListener('click', () => {
    welcomeModal.hidden = true;
    state.welcomed = true;
    persist();
    sound.pop();
    maybeShowGestures();
  });
  $('btnHelp').addEventListener('click', () => { welcomeModal.hidden = false; });
  $('btnReset').addEventListener('click', () => { resetModal.hidden = false; });
  $('btnResetCancel').addEventListener('click', () => { resetModal.hidden = true; });
  $('btnGesturesOk').addEventListener('click', () => {
    gestureModal.hidden = true;
    state.settings.gesturesSeen = true;
    persist();
    sound.pop();
  });

  /* ---------- книга рецептов ---------- */
  const bookSearchEl = $('bookSearch');
  const bookListEl = $('bookList');

  function renderBook() {
    const query = bookSearchEl.value.trim().toLowerCase();
    const lang = getLang();
    const rows = [];
    for (const r of book.recipes) {
      if (!(discovered.has(r.a) && discovered.has(r.b) && discovered.has(r.result))) continue;
      const na = getName(r.a, lang);
      const nb = getName(r.b, lang);
      const nr = getName(r.result, lang);
      if (query && ![r.a, r.b, r.result, na, nb, nr].some((s) => s.toLowerCase().includes(query))) continue;
      rows.push([r, na, nb, nr]);
    }
    rows.sort((x, y) => x[3].localeCompare(y[3], lang === 'ru' ? 'ru' : 'en'));
    const frag = document.createDocumentFragment();
    for (const [r, na, nb, nr] of rows) {
      const row = document.createElement('div');
      row.className = 'book-row';
      const part = (id, name, res = false) => {
        const ic = document.createElement('span');
        ic.className = 'b-ic';
        ic.textContent = getMeta(id).icon;
        const nm = document.createElement('span');
        nm.textContent = name;
        if (res) nm.className = 'b-res';
        return [ic, nm];
      };
      const plus = document.createElement('span');
      plus.className = 'b-plus';
      plus.textContent = '+';
      const arrow = document.createElement('span');
      arrow.className = 'b-plus';
      arrow.textContent = '→';
      row.append(...part(r.a, na), plus, ...part(r.b, nb), arrow, ...part(r.result, nr, true));
      frag.appendChild(row);
    }
    bookListEl.replaceChildren(frag);
    $('bookEmpty').hidden = rows.length > 0;
  }

  $('btnBook').addEventListener('click', () => {
    bookSearchEl.value = '';
    renderBook();
    bookModal.hidden = false;
    bookSearchEl.focus();
  });
  $('btnBookClose').addEventListener('click', () => { bookModal.hidden = true; });
  bookSearchEl.addEventListener('input', renderBook);

  for (const scrim of [resetModal, bookModal, gestureModal]) {
    scrim.addEventListener('click', (e) => {
      if (e.target !== scrim) return;
      scrim.hidden = true;
      if (scrim === gestureModal) { state.settings.gesturesSeen = true; persist(); }
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!bookModal.hidden) { bookModal.hidden = true; return; }
    if (!gestureModal.hidden) {
      gestureModal.hidden = true;
      state.settings.gesturesSeen = true;
      persist();
      return;
    }
    resetModal.hidden = true;
  });

  $('btnResetConfirm').addEventListener('click', () => {
    clearStorage();
    field.clear();
    discovered.clear();
    fresh.clear();
    for (const id of book.base) discovered.add(id);
    state.discovered = [...discovered];
    state.fresh = [];
    state.hintAt = 0;
    state.welcomed = true;
    searchEl.value = '';
    resetModal.hidden = true;
    updateCounter();
    renderPalette();
    refreshHintButton();
    seedBaseTiles();
    persist();
    saveNow(state);
    toast(t('resetDone'), '', 3500);
  });

  $('btnClear').addEventListener('click', () => {
    if (!field.tiles.size) return;
    field.clear();
    sound.remove();
    toast(t('fieldCleared'), '', 2000);
  });

  /* ---------- стартовая раскладка ---------- */
  function seedBaseTiles() {
    const w = fieldEl.clientWidth;
    const h = fieldEl.clientHeight;
    const s = field.tileSize;
    const n = book.base.length;
    const gap = Math.min(s * 1.6, (w - 40) / n);
    const startX = (w - gap * (n - 1) - s) / 2;
    const y = Math.max(20, h * 0.42 - s / 2);
    book.base.forEach((id, i) => {
      field.spawn(id, startX + i * gap, y + (i % 2 === 0 ? 0 : s * 0.5), { animate: true });
    });
  }

  /* ---------- ambient-частицы поля ---------- */
  function spawnMotes() {
    const hues = [268, 42, 168, 322, 18];
    for (let i = 0; i < 9; i++) {
      const m = document.createElement('span');
      m.className = 'mote';
      const size = 3 + Math.random() * 4;
      m.style.width = `${size}px`;
      m.style.height = `${size}px`;
      m.style.left = `${4 + Math.random() * 92}%`;
      m.style.setProperty('--mh', hues[i % hues.length]);
      m.style.setProperty('--sway', `${(Math.random() * 60 - 30).toFixed(0)}px`);
      m.style.animationDuration = `${(13 + Math.random() * 12).toFixed(1)}s`;
      m.style.animationDelay = `${(-Math.random() * 20).toFixed(1)}s`;
      fieldEl.appendChild(m);
    }
  }

  /* ---------- инициализация ---------- */
  applyTheme();
  applyLang();
  updateCounter();
  renderPalette();
  refreshHintButton();
  spawnMotes();

  // Раскладка поля после первого кадра; в фоновой вкладке rAF стоит — подстраховка таймером.
  let fieldLaidOut = false;
  function layoutField() {
    if (fieldLaidOut) return;
    fieldLaidOut = true;
    if (state.tiles.length) {
      field.restore(state.tiles);
      field.clampAll();
    } else {
      seedBaseTiles();
    }
    if (!state.welcomed) welcomeModal.hidden = false;
    else maybeShowGestures();
    persist();
  }
  requestAnimationFrame(layoutField);
  setTimeout(layoutField, 300);

  window.addEventListener('resize', () => field.clampAll());
  window.addEventListener('beforeunload', () => {
    state.tiles = field.serialize();
    state.discovered = [...discovered];
    state.fresh = [...fresh];
    saveNow(state);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      state.tiles = field.serialize();
      saveNow(state);
      platform.gameplayStop();
    } else {
      platform.gameplayStart();
    }
  });

  platform.signalReady(); // SDK Яндекса: игра загрузилась и готова к взаимодействию
}

boot().catch((err) => {
  console.error('[alchemy] Ошибка запуска:', err);
  const p = document.createElement('p');
  p.className = 'noscript';
  p.textContent = 'Не удалось запустить игру. Откройте страницу через локальный сервер (npx serve) или обновите браузер. / Failed to start the game.';
  document.body.appendChild(p);
});