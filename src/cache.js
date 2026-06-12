// Сессионный LRU-кэш предпросмотров (спека 04, этап 3.2). MODULE-LEVEL —
// init() виджета пересоздаёт Modal на каждое открытие карточки, кэш на
// инстансе не пережил бы переключение (находка ревью плана E4).
//
// Три слоя (ключи неймспейсятся вызывающими): 'src:<href>' — байты из amo S3
// (loader.fetchBuffer, все форматы); 'pdf:<href>' — готовый PDF от legacy-
// конвертера; 'office:<href>' — preview-url с TTL (сервер отдаёт ttl_ms).
//
// Кэшируются БУФЕРЫ и строки, НЕ objectURL'ы: Loader.dispose() продолжает
// revoke'ать свои URL как раньше, у кэша нет ownership-конфликта — повторный
// рендер создаёт свежий objectURL из кэшированного буфера (микросекунды).
// Кэшируются только успешные результаты. Приватность не меняется: память
// вкладки, никуда не пишется, умирает с page unload.

const MAX_TOTAL_BYTES = 100 * 1024 * 1024;   // суммарный бюджет буферов
const MAX_ENTRIES = 16;                       // и записей (LRU-вытеснение)

const store = new Map();   // key → { value, bytes, expiresAt }
let totalBytes = 0;

export function cacheGet(key) {
  const e = store.get(key);
  if (!e) return null;
  if (e.expiresAt && Date.now() >= e.expiresAt) { remove(key); return null; }
  store.delete(key);            // LRU-bump: Map хранит порядок вставки
  store.set(key, e);
  return e.value;
}

export function cachePut(key, value, { bytes = 0, ttlMs = 0 } = {}) {
  if (bytes > MAX_TOTAL_BYTES) return;   // не вытесняем весь кэш ради одного гиганта
  if (store.has(key)) remove(key);
  store.set(key, { value, bytes, expiresAt: ttlMs ? Date.now() + ttlMs : 0 });
  totalBytes += bytes;
  while (store.size > MAX_ENTRIES || totalBytes > MAX_TOTAL_BYTES) {
    remove(store.keys().next().value);   // самый старый (head Map'а)
  }
}

function remove(key) {
  const e = store.get(key);
  if (e) { totalBytes -= e.bytes; store.delete(key); }
}

// Для тестов.
export function cacheClear() { store.clear(); totalBytes = 0; }
export function cacheStats() { return { entries: store.size, totalBytes }; }
