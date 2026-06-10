# Ревью E1S3 + конвертер (субагент + codex)

**Дата:** 2026-06-11. Область: единый fetch-слой (T6), рендереры на loader (T7/T8), связка виджет↔конвертер (T16), конвертер (AMO-13). Ревьюеры: независимый субагент Claude + OpenAI Codex.

## Субагент — применённые находки

| # | Находка | Severity | Решение |
|---|---|---|---|
| 1 | `server.js`: токен сравнивался `!==` (timing-leak, побайтовый подбор secret) | БЛОК | ✅ `timingSafeEqual` (`tokenOk()`) |
| 2 | `server.js`: расширение из X-Filename без whitelist → расширяет RCE-поверхность LibreOffice | БЛОК | ✅ `ALLOWED_EXT` whitelist → 415 (проверено живьём) |
| 3 | `server.js`: нет обработки разрыва клиента → soffice крутится впустую, очередь забивается (self-DoS на 2 CPU) | БЛОК | ✅ `req.on('aborted')`/`res.on('close')` → флаг, проверка перед очередью + abort-poll убивает дерево + не пишем в мёртвый сокет |
| 4 | `modal.js`: keydown-слушатель снимался по namespace (мог снять чужой) | важное | ✅ храним ссылку на handler, снимаем именно её |
| 5 | `modal.js`: гонка open→close→open — ошибка отменённого рендера затирала тело новой модалки | важное | ✅ захват локального `loader`, проверка `this._loader !== loader` в catch |
| 8 | `server.js`: stderr LibreOffice (мог содержать путь/имя) попадал в лог | важное | ✅ логируем только код/тип ошибки, без stderr |
| 10 | `docker-compose`: healthcheck на `fetch` (нестабилен на Node 18) | важное | ✅ `http.get` |
| 11 | `test.sh`: `$TMP_DOC` unbound при `set -u` | мелочь | ✅ `TMP_DOC="${TMP_DOC:-}"` |

Не правил (осознанно): #6 (двойной objectURL — dispose ревокает оба, не утечка), #7 (pdf load/timeout race — безвреден), #9 (kill при сбое spawn — гонки нет), #12/14/15 (косметика/вне области).

## Проверка фиксов на живом конвертере (после редеплоя)
- health → 200; контейнер healthy (новый http-healthcheck) ✅
- чужое расширение `.exe` → **415** ✅
- неверный токен → **401** ✅
- реальный `.doc` (кириллица) → **200, %PDF** ✅

## Codex — применённые находки (все 4, новые от субагента)

| Находка | Severity | Решение |
|---|---|---|
| `server.js`: `decodeURIComponent(X-Filename)` вне try → URIError/500 на битом `%` (error-path DoS) | P1 | ✅ decode в try → 400 (проверено: `X-Filename: %` → 400) |
| `server.js`: stdio pipe не читается → soffice мог зависнуть на полном буфере, заняв слот | P2 | ✅ `stdio: 'ignore'` целиком (заодно приватность — stderr не появляется) |
| `server.js`: CORS только в route → ошибки express.raw (413) уходили без CORS → opaque error в браузере | P2 | ✅ error-middleware с applyCors (проверено: 413 несёт ACAO) |
| `docx.js`/`xlsx.js`: `ensureLib()` не дедуплицирует параллельную загрузку vendor → race, лишние `<script>` | P2 | ✅ module-level promise + проверка глобала после onload |

## Проверка codex-фиксов на живом конвертере (редеплой)
- битый `X-Filename: %` → **400** ✅
- оверсайз 51 МБ → **413 с `Access-Control-Allow-Origin`** ✅
- реальный `.doc` → **200 %PDF** ✅; контейнер healthy ✅

## Итог ревью
Субагент: 3 блокирующих (security конвертера) + 4 важных — применены. Codex: 1 P1 + 3 P2 — применены. Все правки передеплоены и проверены вживую. 20/20 тестов зелёные. Не применялись только осознанно-приемлемые мелочи (двойной objectURL под dispose, pdf load/timeout race, косметика). XSS sheet_to_html и реальные фикстуры — остаются на T9/T10 (E1S4).

