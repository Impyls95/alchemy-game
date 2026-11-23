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
  function eraIndexFor(n) {
    const f = n / book.total;
    return f >= 0.9 ? 4 : f >= 0.65 ? 3 : f >= 0.4 ? 2 : f >= 0.15 ? 1 : 0;
  }

  function eraIndex() {
    return eraIndexFor(discovered.size);
  }

  // Ранги алхимика: пороги сознательно не совпадают с эрами — праздники разнесены.
  function rankIndexFor(n) {
    const f = n / book.total;
    return f >= 0.8 ? 4 : f >= 0.55 ? 3 : f >= 0.3 ? 2 : f >= 0.1 ? 1 : 0;
  }

  /* ---------- ежедневный вызов ---------- */
  // Цель дня одинакова у всех игроков: детерминированный хэш даты → элемент.
  // Базы исключаем (у всех открыты), секреты — чтобы не раскрывать пасхалки.
  let dailyPool = null;
  function dailyTarget(dateStr) {
    if (!dailyPool) {
      dailyPool = [...book.elements].filter((id) => !book.base.includes(id) && !getMeta(id).secret).sort();
    }
    let h = 0;
    for (let i = 0; i < dateStr.length; i++) h = (h * 31 + dateStr.charCodeAt(i)) >>> 0;
    return dailyPool[h % dailyPool.length];
  }

  function isoDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // Возвращает id цели, если засчитана именно сейчас. Вызывается из updateCounter;
  // повторные вызовы в тот же день безопасны — guard по lastDaily.
  function updateDaily() {
    const today = isoDate(new Date());
    const target = dailyTarget(today);
    const chip = $('dailyChip');
    const done = discovered.has(target);
    let awarded = null;
    if (done && state.lastDaily !== today) {
      const yesterday = isoDate(new Date(Date.now() - 86400000));
      state.dailyStreak = state.lastDaily === yesterday ? state.dailyStreak + 1 : 1;
      state.lastDaily = today;
      persist();
      awarded = target;
    }
    const label = `${getMeta(target).icon} ${getName(target, getLang())}`;
    chip.textContent = done ? t('dailyDone', { n: state.dailyStreak }) : t('dailyTarget', { target: label });
    chip.dataset.done = done ? '1' : '0';
    chip.title = t(done ? 'dailyTip' : 'dailyInfo', { n: state.dailyStreak, target: label });
    return awarded;
  }

  $('dailyChip').addEventListener('click', () => {
    const today = isoDate(new Date());
    const target = dailyTarget(today);
    const done = discovered.has(target);
    toast(t(done ? 'dailyTip' : 'dailyInfo', { n: state.dailyStreak, target: `${getMeta(target).icon} ${getName(target, getLang())}` }), 'hint', 4500);
  });

  function updateCounter() {
    counterEl.textContent = `${discovered.size} / ${book.total}`;
    progressFill.style.width = `${(discovered.size / book.total) * 100}%`;
    paletteCount.textContent = `${discovered.size}`;
    $('eraChip').textContent = t(`era${eraIndex()}`);
    $('rankChip').textContent = t(`rank${rankIndexFor(discovered.size)}`);
    updateDaily();
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

  /* ---------- достижения ----------
     Условия вычисляются на лету из состояния; achSeen гасит повторные
     поздравления в текущей сессии (в т.ч. при загрузке со старым прогрессом). */
  const FOOD = ['Хлеб', 'Суши', 'Сыр', 'Мёд', 'Яичница', 'Молоко', 'Пшеница', 'Рис'];
  const ACHIEVEMENTS = [
    { icon: '🧪', key: 'ach1', check: () => (state.crafts ?? 0) >= 1 },
    { icon: '⚗️', key: 'ach2', check: () => discovered.has('Феникс') },
    { icon: '🦖', key: 'ach3', check: () => discovered.has('Динозавр') },
    { icon: '🚀', key: 'ach4', check: () => discovered.has('Космонавт') },
    { icon: '🧑‍🍳', key: 'ach5', check: () => FOOD.filter((el) => discovered.has(el)).length >= 5 },
    { icon: '🔭', key: 'ach6', check: () => ['Телескоп', 'Галактика', 'Созвездие'].every((el) => discovered.has(el)) },
    { icon: '💡', key: 'ach7', check: () => (state.crafts ?? 0) >= 25 },
    { icon: '🏆', key: 'ach8', check: () => discovered.size === book.total }
  ];
  const achSeen = new Set(ACHIEVEMENTS.filter((a) => a.check()).map((a) => a.key));

  function checkAchievements() {
    let changed = false;
    for (const a of ACHIEVEMENTS) {
      if (achSeen.has(a.key) || !a.check()) continue;
      achSeen.add(a.key);
      changed = true;
      toast(t('achToast', { name: t(`${a.key}t`) }), 'milestone', 5000);
      sound.milestone();
    }
    if (changed) persist();
  }

  /* ---------- открытие нового элемента ---------- */
  const BIG_MILESTONES = new Set([10, 25, 50, 75, 100]);
  let discoveryTimer = null;
  function handleDiscover(id) {
    if (discovered.has(id)) return;
    const prevEra = eraIndexFor(discovered.size);
    const prevRank = rankIndexFor(discovered.size);
    discovered.add(id);
    fresh.add(id);
    const dailyAward = updateDaily();
    updateCounter();
    renderPalette();
    persist();
    const meta = getMeta(id);
    if (meta.secret) {
      // Пасхалка: особый тост и фанфара вместо обычного звука открытия.
      toast(t('secretFound', { name: getName(id, getLang()) }), 'milestone', 6000);
      sound.milestone();
    } else {
      sound.discover();
    }

    $('discoveryIcon').textContent = meta.icon;
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

    // Вехи: каждые 10 открытий — всплеск в центре поля, ключевые 10/25/50/75/100 — фанфары.
    const n = discovered.size;
    const cx = fieldEl.clientWidth / 2;
    const cy = fieldEl.clientHeight / 2;
    if (n === book.total) {
      toast(t('allDone'), 'hint', 6000);
      field.burst(cx, cy);
    } else if (BIG_MILESTONES.has(n)) {
      toast(t(`milestone${n}`, { n }), 'milestone', 6000);
      sound.milestone();
      field.burst(cx, cy);
    } else if (n % 10 === 0) {
      toast(t('milestone', { n }), 'hint', 4000);
      field.burst(cx, cy);
    }
    // Пересечение порога эры — отдельное поздравление с новой эрой.
    if (n < book.total && eraIndexFor(n) > prevEra) {
      toast(t('eraUp', { era: t(`era${eraIndexFor(n)}`) }), 'milestone', 6000);
    }
    // Повышение ранга алхимика.
    if (n < book.total && rankIndexFor(n) > prevRank) {
      toast(t('rankUp', { rank: t(`rank${rankIndexFor(n)}`) }), 'milestone', 6000);
      sound.milestone();
    }
    // Цель дня открыта крафтом — фанфара поверх остальных поздравлений.
    if (dailyAward) {
      toast(t('dailyUp', { n: state.dailyStreak }), 'milestone', 5000);
      sound.milestone();
    }
    checkAchievements();
  }

  /* ---------- undo последнего слияния ---------- */
  function handleMerged(result, snapshot) {
    state.crafts = (state.crafts ?? 0) + 1;
    persist();
    checkAchievements();
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
    updateCounter(); // чипы эры и ранга в шапке тоже переводятся
    renderPalette();
    field.refreshNames();
    refreshHintButton();
    applySortBtn();
    if (!bookModal.hidden) renderBook();
    if (!achModalHidden()) renderAch();
    applySound();
  }

  function achModalHidden() {
    return $('achModal').hidden;
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
  /* ---------- перенос прогресса (экспорт/импорт кода сохранения) ---------- */
  const saveCodeEl = $('saveCode');
  const encodeSave = (data) => btoa(unescape(encodeURIComponent(JSON.stringify(data))));
  const decodeSave = (code) => JSON.parse(decodeURIComponent(escape(atob(code))));

  $('btnHelp').addEventListener('click', () => { welcomeModal.hidden = false; saveCodeEl.value = ''; });

  $('btnExportSave').addEventListener('click', async () => {
    const code = encodeSave(state);
    saveCodeEl.value = code;
    try {
      await navigator.clipboard.writeText(code);
      toast(t('shareCopied'), 'hint', 2500);
    } catch {
      // Буфер недоступен — код остаётся в поле, выделяем для ручного копирования.
      saveCodeEl.focus();
      saveCodeEl.select();
    }
  });

  $('btnImportSave').addEventListener('click', () => {
    const raw = saveCodeEl.value.trim();
    if (!raw) return;
    let data = null;
    try { data = decodeSave(raw); } catch { /* битый base64/JSON */ }
    if (!data || typeof data !== 'object' || !Array.isArray(data.discovered)) {
      toast(t('importBad'), 'error', 3500);
      return;
    }
    // Настройки (тема, язык, звук) остаются локальными — переносим только прогресс.
    discovered.clear();
    for (const id of data.discovered) {
      if (typeof id === 'string' && book.elements.has(id)) discovered.add(id);
    }
    for (const id of book.base) discovered.add(id);
    state.discovered = [...discovered];
    fresh.clear();
    state.fresh = [];
    if (Number.isFinite(data.crafts)) state.crafts = Math.max(0, Math.floor(data.crafts));
    if (typeof data.lastDaily === 'string') state.lastDaily = data.lastDaily;
    if (Number.isFinite(data.dailyStreak)) state.dailyStreak = Math.max(0, Math.floor(data.dailyStreak));
    field.clear();
    field.restore(Array.isArray(data.tiles)
      ? data.tiles.filter((tl) => tl && typeof tl.el === 'string' && book.elements.has(tl.el))
      : []);
    field.clampAll();
    field.syncEmptyState();
    achSeen.clear();
    for (const a of ACHIEVEMENTS) if (a.check()) achSeen.add(a.key);
    persist();
    welcomeModal.hidden = true;
    updateCounter();
    renderPalette();
    sound.milestone();
    toast(t('importDone'), 'milestone', 4000);
  });

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
      if (r.secret) continue; // пасхалки не светятся в книге даже после открытия
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

  /* ---------- панель достижений ---------- */
  const achModal = $('achModal');
  const achListEl = $('achList');

  function renderAch() {
    const frag = document.createDocumentFragment();
    let done = 0;
    for (const a of ACHIEVEMENTS) {
      const ok = a.check();
      if (ok) done++;
      const item = document.createElement('div');
      item.className = `ach${ok ? ' done' : ''}`;
      const icon = document.createElement('span');
      icon.className = 'ach-icon';
      icon.textContent = a.icon;
      const text = document.createElement('span');
      text.className = 'ach-text';
      const name = document.createElement('strong');
      name.textContent = t(`${a.key}t`);
      const desc = document.createElement('span');
      desc.textContent = t(`${a.key}d`);
      text.append(name, desc);
      item.append(icon, text);
      frag.appendChild(item);
    }
    achListEl.replaceChildren(frag);
    $('achTitle').textContent = `${t('achTitle')} — ${done}/${ACHIEVEMENTS.length}`;
  }

  $('btnAch').addEventListener('click', () => {
    renderAch();
    achModal.hidden = false;
  });
  $('btnAchClose').addEventListener('click', () => { achModal.hidden = true; });

  for (const scrim of [resetModal, bookModal, achModal, gestureModal]) {
    scrim.addEventListener('click', (e) => {
      if (e.target !== scrim) return;
      scrim.hidden = true;
      if (scrim === gestureModal) { state.settings.gesturesSeen = true; persist(); }
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!bookModal.hidden) { bookModal.hidden = true; return; }
    if (!achModal.hidden) { achModal.hidden = true; return; }
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
    state.crafts = 0;
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