// Простой i18n: словари RU/EN + применение к DOM по data-i18n.
const STRINGS = {
  ru: {
    title: 'Алхимия',
    tagline: 'смешивай элементы — открывай мир',
    discovered: 'Открыто',
    hint: 'Подсказка',
    hintWait: 'Подсказка через {s} с',
    help: 'Как играть',
    theme: 'Тема',
    sound: 'Звук',
    soundOn: 'Звук включён',
    soundOff: 'Звук выключен',
    reset: 'Сбросить прогресс',
    clearField: 'Очистить поле',
    palette: 'Элементы',
    search: 'Поиск элемента…',
    nothingFound: 'Ничего не найдено',
    newBadge: 'NEW',
    fieldEmpty: 'Перетащи элементы из палитры сюда',
    dropToRemove: 'Отпусти, чтобы убрать с поля',
    welcomeTitle: 'Добро пожаловать в Алхимию!',
    welcomeText: 'Перетащи один элемент на другой, чтобы создать новый. Начни с четырёх стихий и энергии — и открой весь мир: от пара и лавы до жизни, городов и интернета.',
    welcomeStep1: 'Бери элементы из палитры и перетаскивай на поле',
    welcomeStep2: 'Соединяй плитки друг с другом — удачная пара создаёт новый элемент',
    welcomeStep3: 'Прогресс сохраняется автоматически. Удачи, алхимик!',
    start: 'Начать смешивать',
    resetTitle: 'Сбросить прогресс?',
    resetText: 'Все открытые элементы и поле будут очищены. Это действие нельзя отменить.',
    cancel: 'Отмена',
    confirmReset: 'Сбросить',
    newElement: 'Новый элемент',
    hintTry: 'Попробуй смешать',
    hintNone: 'Все доступные сейчас комбинации уже открыты — экспериментируй с новыми элементами!',
    resetDone: 'Прогресс сброшен. Мир ждёт нового алхимика!',
    fieldCleared: 'Поле очищено',
    mergeFail: 'Не смешивается',
    progress: 'Прогресс открытий',
    langBtn: 'EN',
    langTitle: 'Switch to English',
    allDone: 'Все элементы открыты! Ты — великий алхимик!',
    book: 'Книга рецептов',
    bookHint: 'Здесь только уже открытые сочетания — остальные открывай экспериментами.',
    bookSearch: 'Поиск по книге…',
    bookEmpty: 'Пока нет открытых сочетаний — смешивай элементы!',
    close: 'Закрыть',
    merged: 'Получено',
    undo: 'Вернуть',
    share: 'Поделиться',
    shareCopied: 'Скопировано в буфер обмена',
    shareText: '⚗️ Алхимия: открыто {n}/{m} — эра «{era}». Последние находки: {recent}. Играй тоже: {url}',
    gesturesTitle: 'Подсказка по жестам',
    gesture1: 'Тап по элементу палитры — добавить его на поле',
    gesture2: 'Удержание на элементе + ведение — перетащить',
    gesture3: 'Свайп по палитре — прокрутка. Перетащи плитку с поля в палитру — убрать её',
    gesturesOk: 'Понятно',
    sort: 'Сортировка',
    sortAll: 'все',
    sortNew: 'новые',
    sortAz: 'А-Я',
    era0: 'Стихии', era1: 'Природа', era2: 'Жизнь', era3: 'Цивилизация', era4: 'Космос',
    milestone: 'Веха: {n} элементов открыто!'
  },
  en: {
    title: 'Alchemy',
    tagline: 'mix elements — discover the world',
    discovered: 'Discovered',
    hint: 'Hint',
    hintWait: 'Hint in {s}s',
    help: 'How to play',
    theme: 'Theme',
    sound: 'Sound',
    soundOn: 'Sound on',
    soundOff: 'Sound muted',
    reset: 'Reset progress',
    clearField: 'Clear field',
    palette: 'Elements',
    search: 'Search element…',
    nothingFound: 'Nothing found',
    newBadge: 'NEW',
    fieldEmpty: 'Drag elements from the palette here',
    dropToRemove: 'Release to remove from field',
    welcomeTitle: 'Welcome to Alchemy!',
    welcomeText: 'Drag one element onto another to create something new. Start with the four classical elements plus energy — and discover a whole world, from steam and lava to life, cities and the internet.',
    welcomeStep1: 'Take elements from the palette and drag them onto the field',
    welcomeStep2: 'Drop tiles onto each other — a valid pair creates a new element',
    welcomeStep3: 'Progress is saved automatically. Good luck, alchemist!',
    start: 'Start mixing',
    resetTitle: 'Reset progress?',
    resetText: 'All discovered elements and the field will be cleared. This cannot be undone.',
    cancel: 'Cancel',
    confirmReset: 'Reset',
    newElement: 'New element',
    hintTry: 'Try mixing',
    hintNone: 'Every currently available combination is already discovered — experiment with your new elements!',
    resetDone: 'Progress reset. The world awaits a new alchemist!',
    fieldCleared: 'Field cleared',
    mergeFail: 'No reaction',
    progress: 'Discovery progress',
    langBtn: 'RU',
    langTitle: 'Переключить на русский',
    allDone: 'All elements discovered! You are a grand alchemist!',
    book: 'Recipe book',
    bookHint: 'Only combinations you have already discovered are shown — find the rest by experimenting.',
    bookSearch: 'Search the book…',
    bookEmpty: 'No discovered recipes yet — keep mixing!',
    close: 'Close',
    merged: 'Created',
    undo: 'Undo',
    share: 'Share',
    shareCopied: 'Copied to clipboard',
    shareText: '⚗️ Alchemy: {n}/{m} elements discovered — era "{era}". Recent finds: {recent}. Play too: {url}',
    gesturesTitle: 'Touch gestures',
    gesture1: 'Tap an element in the palette to add it to the field',
    gesture2: 'Press and hold, then drag to move an element',
    gesture3: 'Swipe the palette to scroll. Drag a field tile onto the palette to remove it',
    gesturesOk: 'Got it',
    sort: 'Sort',
    sortAll: 'all',
    sortNew: 'newest',
    sortAz: 'A-Z',
    era0: 'Elements', era1: 'Nature', era2: 'Life', era3: 'Civilization', era4: 'Cosmos',
    milestone: 'Milestone: {n} elements discovered!'
  }
};

let current = 'ru';

export function setLang(lang) {
  current = STRINGS[lang] ? lang : 'ru';
  document.documentElement.lang = current;
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    const key = node.dataset.i18n;
    if (STRINGS[current][key] != null) node.textContent = STRINGS[current][key];
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
    const key = node.dataset.i18nPlaceholder;
    if (STRINGS[current][key] != null) node.placeholder = STRINGS[current][key];
  });
  document.querySelectorAll('[data-i18n-title]').forEach((node) => {
    const key = node.dataset.i18nTitle;
    if (STRINGS[current][key] != null) node.title = STRINGS[current][key];
  });
}

export function getLang() {
  return current;
}

export function t(key, params = {}) {
  let str = STRINGS[current][key] ?? STRINGS.ru[key] ?? key;
  for (const [k, v] of Object.entries(params)) str = str.replaceAll(`{${k}}`, String(v));
  return str;
}