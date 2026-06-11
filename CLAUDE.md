# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Что это

**Nexus Looker** — приватный виджет для amoCRM: добавляет кнопку-«глазик» рядом с каждым вложением в ленте сделки/контакта и открывает предпросмотр файла в модалке без скачивания (PDF, картинки, текст, Markdown, Office-форматы). Две части: **виджет** (клиентский JS, грузится в страницу amoCRM) и **converter/** — отдельный серверный сервис (Express в Docker) для форматов, которые в браузере не отрендерить.

## Команды

```bash
npm install
npm run build        # esbuild → dist/ → releases/nexus-looker-<version>.zip (архив для установки в amoCRM)
npm run clean        # rm -rf dist/*
npm test             # vitest run (jsdom)

npx vitest run test/inject.test.js          # один файл тестов
npx vitest run -t "клик по глазику"          # один тест по названию

# Конвертер (Node, разворачивается в Docker):
node -c converter/server.js                  # быстрая проверка синтаксиса
cd converter && docker compose --env-file .env up -d --build   # сборка/перезапуск (на сервере)
```

**Версию задаёт `manifest.json` (`widget.version`), НЕ package.json** — build читает её оттуда и ею же именует zip. Обновление виджета: bump version в manifest.json → `npm run build` → переустановить zip.

## Архитектура — то, что неочевидно из отдельных файлов

**Виджет живёт в ТОМ ЖЕ window, что и amoCRM** (не iframe). Отсюда два следствия: (1) jQuery и DOM кабинета доступны напрямую — на этом построена врезка глазика; (2) любой XSS в виджете = компрометация amoCRM-сессии, поэтому весь рендер недоверенного контента идёт через безопасные синки (см. ниже).

**Сборка борется с RequireJS amoCRM.** `build.js` собирает `src/` через esbuild в IIFE (`globalName: NXLooker`), затем **оборачивает в `define(["jquery"], function($){ ... return NXLooker.default($); })`** — иначе RequireJS amoCRM не увидит виджет. Entry — `src/script.js` (экспортит фабрику amoCRM CustomWidget с колбэками render/init).

**`src/vendorLoader.js` зануляет `window.define` на время загрузки vendor-скриптов.** Vendor-библиотеки (markdown-it и т.п.) — UMD с anonymous `define`, который RequireJS перехватывает и ломает («Mismatched anonymous define»). vendorLoader временно прячет `window.define`, грузит скрипт тегом, восстанавливает define. Загрузки **сериализованы** (общая цепочка промисов) с таймаутом и guard'ом позднего onload — не трогать эту логику наугад.

**Поток данных при клике на глазик:**
1. `src/inject.js` — MutationObserver на ленте (`.notes-wrapper__notes.js-notes`), врезает глазик в строки вложений И в картинки-превью (`js-image-resizer` — отдельная разметка amoCRM, href без расширения → kind форсируется `image`). Клик ловится **нативным listener на `document` в фазе capture** (amoCRM глушит bubble-фазу `stopPropagation`'ом — jQuery-делегирование клик не получало).
2. `src/modal.js` — открывает модалку, по `kind` (из `fileUtils.detectKind` или `data-kind`) выбирает рендерер из `RENDERERS`, создаёт `Loader` на open и `dispose()` на close (с защитой от гонки переоткрытия: `this._loader !== loader`).
3. `src/loader.js` — единый fetch-слой: **`credentials: 'same-origin'`** (обязательно — `include` ломает CORS-редирект amo→drive→S3), AbortController, трекинг и revoke `objectURL`, ошибки с `langKey` для i18n.
4. `src/renderers/*` — один файл на тип, контракт `({ $, file, $body, params, settings, loader, langs }) => Promise`.

**Граница приватности рендереров (важное продуктовое решение):**
- **Уходят на серверы Microsoft** (Office Online viewer через серверный `/preview-host`): `office.js` для **docx, pptx, xlsx, csv**.
- **Рендерятся локально, никуда не уходят:** `pdf.js` (blob→iframe), `image.js` (blob→`<img>`, включая **svg** — скрипты в svg НЕ исполняются в `<img>`), `text.js`, `markdown.js` (markdown-it с `html:false`), `legacy.js` (.doc/.xls/.ppt → свой конвертер LibreOffice→PDF).
- `fileUtils.js` (`EXT_TO_KIND`) — единственный источник маппинга расширение→рендерер. Менять поведение формата здесь.

**converter/ — отдельный сервис.** `server.js` (Express, Docker, за nginx `https://nexus-oko.naithon.one`):
- `POST /convert` — legacy Office → PDF через LibreOffice headless (per-request профиль, kill process-tree по таймауту/abort, p-limit).
- `POST /preview-host` — временно публикует файл под uuid-URL (TTL), откуда его качает Microsoft viewer; csv конвертит в xlsx. `requireToken` middleware стоит ДО `express.raw` (тело не буферизуется без токена).
- Аутентификация — shared-token (`timingSafeEqual`); токен светится в клиенте осознанно, реальная защита — Origin-allowlist + лимиты. Конфиг nginx/compose — в `converter/deploy/`.

## Тесты

vitest + jsdom. `test/inject.test.js` монтирует реальную разметку ленты amoCRM из `work_directory/tests/fixtures/dom/` и проверяет врезку/клик. При изменении рендереров/маппинга обновляй `test/fileUtils.test.js`.

## Рабочий процесс

Разработка в ветке `oleg`; `master` защищён (прямой push заблокирован) и обновляется только через merge-гейт (clone → проверка конфликтов → `npm ci && npm test && npm run build` + проверка конвертера → `merge --no-ff`). Детали — `COMMIT_CONVENTION.md`. Управление проектом (план, спринты) — в `work_directory/00_global_plan/`; ревью и расследования — `work_directory/04_reviews/`.

## Контекст, которого нет в коде

Целевой кабинет `venskons78.amocrm.ru` — **технический аккаунт** разработчика: виджет в нём НЕ исполняется автоматически (это режим аккаунта, не баг). Для ручного теста/демо используется букмарклет, грузящий `boot.js` со статики сервера (`widget-host/`, отдаётся nginx `/widget/`). Реальный прод требует обычного рабочего аккаунта — см. `work_directory/04_reviews/08_autoload_investigation.md`. Секреты (CONVERTER_TOKEN, SSH-ключ, .env) — только на сервере/локально, НЕ в git.
