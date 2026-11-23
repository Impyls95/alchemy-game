// Игровое поле: плитки, drag & drop на Pointer Events (мышь + тач единым кодом),
// слияние, анимации и звуки. Никаких глобальных переменных — всё в классах.
import { getMeta, getName } from './elements.js';
import { getLang } from './i18n.js';

// Стабильный «цвет элемента»: золотой угол по хэшу id → равномерно разные оттенки.
export function hueFor(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h * 137.508) % 360;
}

const SPARK_COLORS = ['#f6b73c', '#2fe0c2', '#ff5cb8', '#a06bff', '#ff7a45'];

/* ---------- звук: лёгкий синтез через WebAudio, без внешних файлов ---------- */
export class Sound {
  constructor(enabled = true) {
    this.enabled = enabled;
    this.ctx = null;
  }

  ensureCtx() {
    if (!this.enabled) return null;
    try {
      this.ctx ??= new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    } catch {
      return null;
    }
  }

  tone(freq, dur, { type = 'sine', gain = 0.12, delay = 0, slide = 0 } = {}) {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  pickup() { this.tone(520, 0.07, { gain: 0.05 }); }
  pop() { this.tone(440, 0.16, { slide: 440, gain: 0.14 }); this.tone(880, 0.12, { delay: 0.05, gain: 0.07 }); }
  error() { this.tone(160, 0.18, { type: 'square', gain: 0.05, slide: -60 }); }
  remove() { this.tone(300, 0.12, { slide: -140, gain: 0.06 }); }
  discover() {
    this.tone(523, 0.14, { gain: 0.12 });
    this.tone(659, 0.14, { delay: 0.1, gain: 0.12 });
    this.tone(784, 0.22, { delay: 0.2, gain: 0.13 });
    this.tone(1047, 0.3, { delay: 0.3, gain: 0.1 });
  }
  milestone() {
    this.tone(392, 0.1, { type: 'triangle', gain: 0.08 });
    this.tone(523, 0.1, { type: 'triangle', delay: 0.09, gain: 0.09 });
    this.tone(659, 0.1, { type: 'triangle', delay: 0.18, gain: 0.1 });
    this.tone(784, 0.14, { type: 'triangle', delay: 0.27, gain: 0.11 });
    this.tone(1047, 0.4, { type: 'triangle', delay: 0.36, gain: 0.12 });
  }
}

/* ---------- игровое поле ---------- */
export class Field {
  /**
   * @param {HTMLElement} root контейнер поля
   * @param {import('./recipes.js').RecipeBook} book
   * @param {object} hooks { onDiscover(id), onChange(), sound, paletteEl }
   */
  constructor(root, book, hooks) {
    this.root = root;
    this.book = book;
    this.hooks = hooks;
    this.tiles = new Map(); // uid -> { uid, el, x, y, node }
    this.drag = null;
    this.raf = 0;
    this.uidSeq = 0;

    // Делегирование: один слушатель на всё поле, сколько бы плиток ни было.
    this.root.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.root.addEventListener('pointermove', (e) => this.onPointerMove(e));
    this.root.addEventListener('pointerup', (e) => this.onPointerUp(e));
    this.root.addEventListener('pointercancel', (e) => this.onPointerCancel(e));
    this.root.addEventListener('dblclick', (e) => {
      const node = e.target.closest('.tile');
      if (node && !this.drag) this.remove(node.dataset.uid, true);
    });
    this.root.addEventListener('contextmenu', (e) => {
      if (e.target.closest('.tile')) e.preventDefault();
    });
  }

  get tileSize() {
    return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tile-size')) || 86;
  }

  clampPos(x, y) {
    const s = this.tileSize;
    const w = this.root.clientWidth;
    const h = this.root.clientHeight;
    return {
      x: Math.min(Math.max(4, x), Math.max(4, w - s - 4)),
      y: Math.min(Math.max(4, y), Math.max(4, h - s - 4))
    };
  }

  buildNode(elId) {
    const node = document.createElement('div');
    node.className = 'tile';
    node.style.setProperty('--h', hueFor(elId).toFixed(1));
    const sigil = document.createElement('span');
    sigil.className = 'sigil';
    const icon = document.createElement('span');
    icon.className = 'tile-icon';
    icon.textContent = getMeta(elId).icon;
    const name = document.createElement('span');
    name.className = 'tile-name';
    name.textContent = getName(elId, getLang());
    node.append(sigil, icon, name);
    return node;
  }

  spawn(elId, x, y, { animate = true } = {}) {
    const uid = `t${Date.now().toString(36)}_${this.uidSeq++}`;
    const pos = this.clampPos(x, y);
    const node = this.buildNode(elId);
    node.dataset.uid = uid;
    node.style.left = `${pos.x}px`;
    node.style.top = `${pos.y}px`;
    if (animate) {
      node.classList.add('spawn');
      node.addEventListener('animationend', () => node.classList.remove('spawn'), { once: true });
      setTimeout(() => node.classList.remove('spawn'), 600);
    }
    this.root.appendChild(node);
    this.tiles.set(uid, { uid, el: elId, x: pos.x, y: pos.y, node });
    this.syncEmptyState();
    this.hooks.onChange();
    return uid;
  }

  remove(uid, withSound = false) {
    const tile = this.tiles.get(uid);
    if (!tile) return;
    this.tiles.delete(uid);
    tile.node.classList.add('vanish');
    tile.node.addEventListener('animationend', () => tile.node.remove(), { once: true });
    setTimeout(() => tile.node.remove(), 400); // страховка, если анимации отключены
    this.syncEmptyState();
    if (withSound) this.hooks.sound?.remove();
    this.hooks.onChange();
  }

  clear() {
    for (const uid of [...this.tiles.keys()]) this.remove(uid);
  }

  serialize() {
    return [...this.tiles.values()].map(({ uid, el, x, y }) => ({ uid, el, x, y }));
  }

  restore(saved) {
    for (const t of saved) {
      if (!this.book.elements.has(t.el)) continue; // элемент исчез из рецептов — пропускаем
      const uid = this.spawn(t.el, t.x ?? 20, t.y ?? 20, { animate: false });
      this.tiles.get(uid).node.dataset.uid = uid;
    }
  }

  // Полный откат поля к снимку (undo слияния): текущие плитки заменяются сохранёнными.
  restoreSnapshot(saved) {
    this.clear();
    for (const t of saved) {
      if (!this.book.elements.has(t.el)) continue;
      this.spawn(t.el, t.x ?? 20, t.y ?? 20, { animate: false });
    }
  }

  refreshNames() {
    for (const tile of this.tiles.values()) {
      tile.node.querySelector('.tile-name').textContent = getName(tile.el, getLang());
    }
  }

  clampAll() {
    for (const tile of this.tiles.values()) {
      const pos = this.clampPos(tile.x, tile.y);
      tile.x = pos.x;
      tile.y = pos.y;
      tile.node.style.left = `${pos.x}px`;
      tile.node.style.top = `${pos.y}px`;
    }
  }

  syncEmptyState() {
    this.root.classList.toggle('has-tiles', this.tiles.size > 0);
  }

  /* ---------- drag & drop ---------- */

  onPointerDown(e) {
    if (this.drag) return;
    const node = e.target.closest('.tile');
    if (!node || e.button > 0) return;
    const tile = this.tiles.get(node.dataset.uid);
    if (!tile) return;
    e.preventDefault();
    try { node.setPointerCapture(e.pointerId); } catch { /* синтетический/уже отпущенный pointer */ }
    const rect = this.root.getBoundingClientRect();
    this.drag = {
      uid: tile.uid,
      pointerId: e.pointerId,
      offsetX: e.clientX - rect.left - tile.x,
      offsetY: e.clientY - rect.top - tile.y,
      originX: tile.x,
      originY: tile.y,
      lastX: e.clientX,
      lastY: e.clientY,
      moved: false,
      targetUid: null,
      overPalette: false
    };
    node.classList.add('dragging');
    this.preDrag = this.serialize(); // снимок до перемещения: undo возвращает плитки туда, где их взяли
    this.hooks.sound?.pickup();
  }

  onPointerMove(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    d.lastX = e.clientX;
    d.lastY = e.clientY;
    if (!d.moved) d.moved = true;
    if (!this.raf) this.raf = requestAnimationFrame(() => this.updateDrag());
  }

  updateDrag() {
    this.raf = 0;
    const d = this.drag;
    if (!d) return;
    const tile = this.tiles.get(d.uid);
    if (!tile) { this.drag = null; return; }
    const rect = this.root.getBoundingClientRect();
    const pos = this.clampPos(d.lastX - rect.left - d.offsetX, d.lastY - rect.top - d.offsetY);
    tile.x = pos.x;
    tile.y = pos.y;
    tile.node.style.left = `${pos.x}px`;
    tile.node.style.top = `${pos.y}px`;

    // Зона слияния: центр перетаскиваемой плитки над другой плиткой.
    const s = this.tileSize;
    const cx = pos.x + s / 2;
    const cy = pos.y + s / 2;
    let target = null;
    for (const other of this.tiles.values()) {
      if (other.uid === d.uid) continue;
      if (cx >= other.x && cx <= other.x + s && cy >= other.y && cy <= other.y + s) {
        target = other; // последний в порядке отрисовки = верхняя плитка
      }
    }
    if (d.targetUid !== target?.uid) {
      if (d.targetUid) this.tiles.get(d.targetUid)?.node.classList.remove('merge-target');
      d.targetUid = target?.uid ?? null;
      target?.node.classList.add('merge-target');
    }

    // Наведение на палитру = удаление плитки с поля.
    const pal = this.hooks.paletteEl;
    let overPalette = false;
    if (pal) {
      const pr = pal.getBoundingClientRect();
      overPalette = d.lastX >= pr.left && d.lastX <= pr.right && d.lastY >= pr.top && d.lastY <= pr.bottom;
    }
    if (overPalette !== d.overPalette) {
      d.overPalette = overPalette;
      pal?.classList.toggle('drop-remove', overPalette);
    }
  }

  onPointerUp(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
    d.lastX = e.clientX;
    d.lastY = e.clientY;
    this.updateDrag(); // фиксируем финальную позицию/цель
    const tile = this.tiles.get(d.uid);
    this.drag = null;
    this.hooks.paletteEl?.classList.remove('drop-remove');
    if (!tile) return;
    tile.node.classList.remove('dragging');
    if (d.targetUid) this.tiles.get(d.targetUid)?.node.classList.remove('merge-target');

    if (d.overPalette) {
      this.remove(d.uid, true);
      return;
    }
    if (d.targetUid) {
      this.tryMerge(d.uid, d.targetUid, d);
      return;
    }
    this.hooks.onChange(); // просто переставили плитку
  }

  onPointerCancel(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
    this.drag = null;
    this.hooks.paletteEl?.classList.remove('drop-remove');
    const tile = this.tiles.get(d.uid);
    if (!tile) return;
    tile.node.classList.remove('dragging');
    if (d.targetUid) this.tiles.get(d.targetUid)?.node.classList.remove('merge-target');
    this.returnTo(tile, d.originX, d.originY);
  }

  returnTo(tile, x, y) {
    tile.node.classList.add('returning');
    tile.x = x;
    tile.y = y;
    tile.node.style.left = `${x}px`;
    tile.node.style.top = `${y}px`;
    setTimeout(() => tile.node.classList.remove('returning'), 300);
  }

  tryMerge(aUid, bUid, d) {
    const a = this.tiles.get(aUid);
    const b = this.tiles.get(bUid);
    if (!a || !b) return;
    const result = this.book.find(a.el, b.el);

    if (!result) {
      // Нет рецепта: обе плитки трясутся, перетаскиваемая возвращается назад.
      this.hooks.sound?.error();
      for (const t of [a, b]) {
        t.node.classList.add('shake');
        t.node.addEventListener('animationend', () => t.node.classList.remove('shake'), { once: true });
        setTimeout(() => t.node.classList.remove('shake'), 500);
      }
      this.returnTo(a, d.originX, d.originY);
      return;
    }

    const snapshot = this.preDrag ?? this.serialize(); // для undo: поле до взятия плитки
    const s = this.tileSize;
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    this.remove(aUid);
    this.remove(bUid);
    this.burst(midX + s / 2, midY + s / 2);
    this.hooks.sound?.pop();
    this.spawn(result, midX, midY);
    this.hooks.onDiscover(result);
    this.hooks.onMerged?.(result, snapshot);
  }

  /* ---------- эффекты ---------- */
  burst(cx, cy) {
    const flash = document.createElement('div');
    flash.className = 'merge-flash';
    const fs = this.tileSize * 1.4;
    flash.style.cssText = `left:${cx - fs / 2}px;top:${cy - fs / 2}px;width:${fs}px;height:${fs}px`;
    flash.addEventListener('animationend', () => flash.remove(), { once: true });
    setTimeout(() => flash.remove(), 700); // страховка для скрытой вкладки (анимации на паузе)
    this.root.appendChild(flash);

    for (let i = 0; i < 14; i++) {
      const spark = document.createElement('span');
      spark.className = 'spark';
      const angle = (Math.PI * 2 * i) / 14 + Math.random() * 0.5;
      const dist = 40 + Math.random() * 70;
      spark.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
      spark.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
      spark.style.setProperty('--spark-color', SPARK_COLORS[i % SPARK_COLORS.length]);
      spark.style.left = `${cx}px`;
      spark.style.top = `${cy}px`;
      spark.addEventListener('animationend', () => spark.remove(), { once: true });
      setTimeout(() => spark.remove(), 800); // страховка для скрытой вкладки
      this.root.appendChild(spark);
    }
  }
}