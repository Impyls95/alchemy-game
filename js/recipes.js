// Загрузка и валидация рецептов.
// Основной источник — data/recipes.json (можно расширять без изменения кода).
// Если fetch недоступен (например, страница открыта как file://), используется
// встроенная копия тех же данных из recipes-fallback.js — игра всё равно работает.
import { FALLBACK_DATA } from './recipes-fallback.js';

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export class RecipeBook {
  constructor(data) {
    this.base = [...data.base];
    this.map = new Map();       // "A|B" (отсортировано) -> result
    this.recipes = [];
    this.elements = new Set(this.base);

    for (const r of data.recipes ?? []) {
      if (!r || typeof r.a !== 'string' || typeof r.b !== 'string' || typeof r.result !== 'string') {
        console.warn('[alchemy] Пропущен некорректный рецепт:', r);
        continue;
      }
      const key = pairKey(r.a, r.b);
      if (this.map.has(key) && this.map.get(key) !== r.result) {
        console.warn(`[alchemy] Конфликт рецептов для пары ${r.a} + ${r.b}: оставляю "${this.map.get(key)}", пропускаю "${r.result}"`);
        continue;
      }
      this.map.set(key, r.result);
      this.recipes.push({ a: r.a, b: r.b, result: r.result, secret: !!r.secret });
      this.elements.add(r.a);
      this.elements.add(r.b);
      this.elements.add(r.result);
    }

    this.validateReachability();
  }

  // BFS от базовых элементов: каждый элемент должен быть достижим.
  validateReachability() {
    const reachable = new Set(this.base);
    let changed = true;
    while (changed) {
      changed = false;
      for (const r of this.recipes) {
        if (!reachable.has(r.result) && reachable.has(r.a) && reachable.has(r.b)) {
          reachable.add(r.result);
          changed = true;
        }
      }
    }
    this.unreachable = [...this.elements].filter((el) => !reachable.has(el));
    if (this.unreachable.length) {
      console.warn('[alchemy] Недостижимые элементы (проверьте рецепты):', this.unreachable);
    }
    return this.unreachable;
  }

  find(a, b) {
    return this.map.get(pairKey(a, b)) ?? null;
  }

  // Подсказка: рецепт, где оба ингредиента уже открыты, а результат — ещё нет.
  // Секретные рецепты не выдаются — их находят только экспериментом.
  hint(discoveredSet) {
    const candidates = this.recipes.filter(
      (r) => !r.secret && discoveredSet.has(r.a) && discoveredSet.has(r.b) && !discoveredSet.has(r.result)
    );
    if (!candidates.length) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  get total() {
    return this.elements.size;
  }
}

export async function loadRecipes() {
  try {
    const res = await fetch('data/recipes.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return new RecipeBook(await res.json());
  } catch (err) {
    console.warn('[alchemy] recipes.json недоступен (file://?), использую встроенную копию:', err.message);
    return new RecipeBook(FALLBACK_DATA);
  }
}