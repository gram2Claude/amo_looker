# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Что это

**Nexus Looker** — виджет для amoCRM (готовится к публикации в маркетплейсе, см. `public_integration/`): добавляет кнопку-«глазик» рядом с каждым вложением в ленте сделки/контакта и открывает предпросмотр файла в модалке без скачивания (PDF, картинки, текст, Markdown, Office-форматы). Две части: **виджет** (клиентский JS, грузится в страницу amoCRM) и **converter/** — отдельный серверный сервис (Express в Docker) для форматов, которые в браузере не отрендерить.

## Команды

```bash
npm install
npm run build        # esbuild → dist/ → releases/nexus-looker-<version>.zip (архив для установки в amoCRM)
npm run clean        # rm -rf dist/*
npm test             # vitest run (jsdom)

npx vitest run test/inject.test.js          # один файл тестов
npx vitest run -t "клик по глазику"          # один тест по названию

# Конвертер (Node, разворачивается в Docker):
node -c converter/app.js                     # быстрая проверка синтаксиса
npx vitest run test/converter.app.test.js    # тесты auth/лимитов (supertest + DI-мок convert)
cd converter && docker compose --env-file .env up -d --build   # сборка/перезапуск (на сервере)
```

**Версию задаёт `manifest.json` (`widget.version`), НЕ package.json** — build читает её оттуда и ею же именует zip. Обновление виджета: bump version в manifest.json → `npm run build` → переустановить zip.

**Релиз-zip закоммичен в git** (`releases/nexus-looker-<version>.zip`). `npm run build` перезаписывает его другими байтами (таймстампы внутри архива) даже без изменений кода — после проверочной сборки возвращай `git checkout -- releases/`, если не делаешь релиз.

## Архитектура — то, что неочевидно из отдельных файлов

**Виджет живёт в ТОМ ЖЕ window, что и amoCRM** (не iframe). Отсюда два следствия: (1) jQuery и DOM кабинета доступны напрямую — на этом построена врезка глазика; (2) любой XSS в виджете = компрометация amoCRM-сессии, поэтому весь рендер недоверенного контента идёт через безопасные синки (см. ниже).

**Сборка борется с RequireJS amoCRM.** `build.js` собирает `src/` через esbuild в IIFE (`globalName: NXLooker`), затем **оборачивает в `define(["jquery"], function($){ ... return NXLooker.default($); })`** — иначе RequireJS amoCRM не увидит виджет. Entry — `src/script.js` (экспортит фабрику amoCRM CustomWidget с колбэками render/init).

**Все зависимости инлайнятся в бандл** (markdown-it — npm-зависимость, esbuild её встраивает). Догрузка скриптов через `createElement('script')` ЗАПРЕЩЕНА требованиями amoCRM к публичным интеграциям (п. 3.2) — прежний vendorLoader выпилен. `build.js` содержит **build-guard**: сборка падает, если в бандле появились `createElement('script')`, `eval(`, `new Function`, `alert(`, `confirm(`, `define.amd`, либо в dist попали `*.min.*`-файлы или `vendor/`.

**Поток данных при клике на глазик:**
1. `src/inject.js` — MutationObserver на ленте (`.notes-wrapper__notes.js-notes`), врезает глазик в строки вложений И в картинки-превью (`js-image-resizer` — отдельная разметка amoCRM, href без расширения → kind форсируется `image`). Клик ловится **нативным listener на `document` в фазе capture** (amoCRM глушит bubble-фазу `stopPropagation`'ом — jQuery-делегирование клик не получало).
2. `src/modal.js` — открывает модалку, по `kind` (из `fileUtils.detectKind` или `data-kind`) выбирает рендерер из `RENDERERS`, создаёт `Loader` на open и `dispose()` на close (с защитой от гонки переоткрытия: `this._loader !== loader`).
3. `src/loader.js` — единый fetch-слой: **`credentials: 'same-origin'`** (обязательно — `include` ломает CORS-редирект amo→drive→S3), AbortController, трекинг и revoke `objectURL`, ошибки с `langKey` для i18n.
4. `src/renderers/*` — один файл на тип, контракт `({ $, file, $body, params, loader, langs }) => Promise`. Эндпоинты конвертера — константы модулей (`office.js`, `legacy.js`); токенов и settings-оверрайдов в клиенте нет (публичный zip — не место для секретов).

**Граница приватности рендереров (важное продуктовое решение):**
- **Уходят на серверы Microsoft** (Office Online viewer через серверный `/preview-host`): `office.js` для **docx, pptx, xlsx, csv**.
- **Рендерятся локально, никуда не уходят:** `pdf.js` (blob→iframe), `image.js` (blob→`<img>`, включая **svg** — скрипты в svg НЕ исполняются в `<img>`), `text.js`, `markdown.js` (markdown-it с `html:false`), `legacy.js` (.doc/.xls/.ppt → свой конвертер LibreOffice→PDF).
- `fileUtils.js` (`EXT_TO_KIND`) — единственный источник маппинга расширение→рендерер. Менять поведение формата здесь.

**converter/ — отдельный сервис** (Docker, за nginx `https://nexus-oko.naithon.one`). `app.js` — фабрика `createApp({ convert })` (DI для тестов), `server.js` — entry (listen + TTL-уборка), `convert.js` — LibreOffice:
- `POST /convert` — legacy Office → PDF через LibreOffice headless (per-request профиль, kill process-tree по таймауту/abort, p-limit).
- `POST /preview-host` — временно публикует файл под uuid-URL (TTL 5 мин), откуда его качает Microsoft viewer; csv конвертит в xlsx.
- **Аутентификация публичная**: Origin кабинета amoCRM/Kommo (однометочный поддомен, `ALLOWED_ORIGIN_PATTERN`) ИЛИ служебный `X-Source-Token` (`timingSafeEqual`). `requireAuth` стоит ДО `express.raw` (тело не буферизуется без auth) — этот инвариант не ломать.
- **Эшелон лимитов** (Origin подделывается из curl — принятый риск, спека §8): глобальный `MAX_INFLIGHT` (503 до буферизации), rate-limit 60-сек окно по двум ключам origin+ip (ip — из `X-Real-IP` nginx), nginx `limit_req`. Конфиг nginx/compose — в `converter/deploy/`.

## Тесты

vitest + jsdom. `test/inject.test.js` монтирует реальную разметку ленты amoCRM из `work_directory/tests/fixtures/dom/` и проверяет врезку/клик. При изменении рендереров/маппинга обновляй `test/fileUtils.test.js`.

## Рабочий процесс

Разработка в ветке `oleg`; код попадает в `master` только через merge-гейт (проверка конфликтов → `npm test && npm run build` + проверка конвертера → `merge --no-ff`). Детали — `COMMIT_CONVENTION.md`. Исключение: крон-синк глобального плана (01:01 и 08:00 МСК) коммитит план-факт и `reports/` **прямо в master** и пушит — «чужие» коммиты плана в master это он, не трогать. Перед новой работой догоняй `oleg` до master: `git checkout oleg && git merge --ff-only master`. Управление проектом (план, спринты) — в `work_directory/00_global_plan/`; ревью и расследования — `work_directory/04_reviews/`; письма владельцу/партнёрам — `work_directory/letters/`.

## Контекст, которого нет в коде

Целевой кабинет `venskons78.amocrm.ru` — **технический аккаунт** разработчика: виджет в нём НЕ исполняется автоматически (это режим аккаунта, не баг). Для ручного теста/демо используется букмарклет, грузящий `boot.js` со статики сервера (`widget-host/`, отдаётся nginx `/widget/`). Тестовые сделки с файлами всех форматов: 3200807 и 3177663. После передеплоя статики сверяй, что прод отдаёт ровно код из релиз-архива: sha256 `https://nexus-oko.naithon.one/widget/script.js` против `script.js` внутри zip. Реальный прод требует обычного рабочего аккаунта — см. `work_directory/04_reviews/08_autoload_investigation.md`. Секреты (CONVERTER_TOKEN, SSH-ключ, .env) — только на сервере/локально, НЕ в git.

## Учёт работ: план и «Прочие работы» (timechecker)

Любая работа должна существовать в реестре задач timechecker — иначе её не видно ни в план-факте, ни в кабинете nexus_admin (урок 12.06.2026: пласт внеплановых работ amo_looker не попал в учёт).

- **Появился новый план/спека с объёмом работ** → задачи добавляются в канон глобального плана (`work_directory/00_global_plan/00_amo_looker_plan.json`) через скилл /workflow_global_plan (режим replan), затем `timechecker task import`. Спека без задач в каноне — не план.
- **Работа вне плана** → ПЕРЕД началом: `timechecker task add --slug amo_looker --title "…" --estimate-h N` (печатает ID, спринт прицепится по дате) → `timechecker task start <ID>` → по завершении `timechecker task done <ID>`. Задача появится в узле «Прочие работы» спринта в кабинете.
- ID в коммитах — только выданные реестром (`task add`/`task list`), руками не сочинять: коллизия AMO-N с реестром уже случалась (NEXADM-36/37).
