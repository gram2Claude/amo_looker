// Единый загрузчик файлов для всех рендереров. Один экземпляр на открытие
// модалки: трекает AbortController'ы и objectURL'ы, чтобы close() мог отменить
// незавершённые загрузки и освободить память (revokeObjectURL).
//
// credentials:'same-origin' — НЕ 'include': кука нужна только на первом
// same-origin хопе, на CORS-редиректе amo→drive→S3 credentialed-запрос
// несовместим с ACAO:* (доказано разведкой, 01_dom_recon_amocrm.md).

// Ошибка с ключом локализации (modal покажет langs.widget.errors[langKey]).
export function keyedError(langKey, detail, langParams) {
  const e = new Error(detail || langKey);
  e.langKey = langKey;
  if (langParams) e.langParams = langParams;
  return e;
}

export default class Loader {
  constructor() {
    this._controllers = new Set();
    this._urls = new Set();
  }

  // Загрузить файл → { buf, bytes, contentType }. maxBytes проверяется ПОСЛЕ
  // загрузки по реальному размеру (content-length ненадёжен при chunked).
  async fetchBuffer(href, { maxBytes } = {}) {
    const ctrl = new AbortController();
    this._controllers.add(ctrl);
    try {
      let resp;
      try {
        resp = await fetch(href, { credentials: 'same-origin', signal: ctrl.signal });
      } catch (e) {
        if (e && e.name === 'AbortError') throw e;       // модалку закрыли
        throw keyedError('fetch_failed', 'network: ' + (e && e.message));
      }
      if (!resp.ok) throw keyedError('fetch_failed', 'HTTP ' + resp.status);
      const buf = await resp.arrayBuffer();
      if (maxBytes && buf.byteLength > maxBytes) {
        throw keyedError('too_large', 'bytes ' + buf.byteLength, { limit: humanSize(maxBytes) });
      }
      return { buf, bytes: buf.byteLength, contentType: resp.headers.get('content-type') || '' };
    } finally {
      this._controllers.delete(ctrl);
    }
  }

  // POST на внешний сервис (конвертер). Отдельно от fetchBuffer: cross-origin,
  // без credentials. Тоже отменяется при dispose().
  async post(url, body, headers) {
    const ctrl = new AbortController();
    this._controllers.add(ctrl);
    try {
      return await fetch(url, { method: 'POST', headers, body, signal: ctrl.signal });
    } finally {
      this._controllers.delete(ctrl);
    }
  }

  // Создать blob: URL под уже загруженный буфер; трекается для revoke в dispose().
  objectURL(buf, type) {
    const url = URL.createObjectURL(new Blob([buf], type ? { type } : undefined));
    this._urls.add(url);
    return url;
  }

  // Отменить все незавершённые загрузки и освободить objectURL'ы.
  dispose() {
    this._controllers.forEach((c) => { try { c.abort(); } catch (e) { /* already done */ } });
    this._controllers.clear();
    this._urls.forEach((u) => { try { URL.revokeObjectURL(u); } catch (e) { /* noop */ } });
    this._urls.clear();
  }
}

function humanSize(bytes) {
  const mb = bytes / (1024 * 1024);
  return (Number.isInteger(mb) ? mb : mb.toFixed(0)) + ' МБ';
}
