# Инвентарь переиспользуемых материалов из raw/

> **AMO-1 (2026-06-10): код перенесён из `reuse/source/` в корень репо** (src/, build.js, manifest.json, style.css, i18n/, images/, package.json) с фиксом `credentials:'same-origin'`; `reuse/source/` удалён. Здесь остались только документы (`docs/`) и этот инвентарь как история решений.

**Дата:** 2026-06-10. Источник: `raw/toolkeeper-looker-handoff/` (handoff от Михаила).
Сюда скопировано всё переиспользуемое, очищенное от мусора (`__MACOSX/`, `.DS_Store`, артефакты сборки).

## Вердикты по файлам

### Документы → `reuse/docs/`

| Файл | Вердикт | Комментарий |
|---|---|---|
| `handoff_plan.md` | **База глобального плана** | Шаги 0–8, риски, верификация (10 e2e-проверок), контракт конвертера. Шаг 0 (DOM-разведка) уже выполнен нами 2026-06-10, шаг 1 (каркас) готов в handoff. |
| `handoff_README.md` | **Контекст + known issues** | 3 блокера, инструкция сборки/заливки, версии vendor-библиотек (docx-preview@0.3.5, xlsx@0.18.5). |

### Исходники → `reuse/source/` (рабочая база кода)

| Файл | Вердикт | Что менять |
|---|---|---|
| `manifest.json` | ✅ как есть | interface_version 2, locations lcard/ccard/comcard/advanced_settings. Возможно убрать advanced_settings в v1. |
| `src/script.js` | ✅ как есть | AMD-обёртка + callbacks render/init/bind_actions/destroy — корректная структура. |
| `src/inject.js` | ⚠️ заменить селекторы | Архитектура (Injector, MutationObserver, дедуп `data-tk-injected`) готова. `FILE_ROW_SELECTORS`/`FEED_ROOT_SELECTORS` — плейсхолдеры, **все мимо реального DOM**. Реальные: контейнер `.notes-wrapper__notes.js-notes`, строка `.feed-note__joined-attach-item`, ссылка `a.feed-note__joined-attach__link` (см. `work_directory/01_specs/01_dom_recon_amocrm.md`). |
| `src/modal.js` | ✅ как есть | Оверлей, Esc/клик-вне, роутер рендереров, i18n-хелпер. |
| `src/fileUtils.js` | ✅ как есть | ext→kind маппинг покрывает все целевые форматы. |
| `src/renderers/docx.js` | 🐞 **фикс fetch** | `credentials:'include'` → `'same-origin'` — include ломается на CORS-редиректе amo→drive→S3 (доказано разведкой). Ленивая подгрузка vendor через `params.path` — ок. |
| `src/renderers/xlsx.js` | 🐞 **фикс fetch** | То же + лимит 10 МБ уже есть. |
| `src/renderers/text.js` | 🐞 **фикс fetch** | То же + лимит 2 МБ уже есть. |
| `src/renderers/legacy.js` | 🐞 **фикс fetch** | То же; контракт конвертера (X-Filename/X-Source-Token) написан против plan.md шаг 5 — конвертера ещё нет. |
| `src/renderers/pdf.js` | ⚠️ проверить iframe | iframe на `file.href`: same-origin URL браузер пройдёт по редиректам, но если Content-Disposition=attachment — будет скачивание вместо рендера. Проверить на живом; запасной план — pdf.js (vendor). |
| `src/renderers/image.js` | ⚠️ проверить img | `<img src=href>` — те же риски редиректов; вероятно ок (браузерная загрузка). |
| `style.css` | ✅ как есть | Глазик + модалка + стили рендереров. |
| `i18n/ru.json`, `en.json` | ✅ как есть | Все строки UI и ошибок. |
| `images/*.png` (5 шт.) | ✅ как есть | Плейсхолдеры правильных размеров — для приватного виджета достаточно. |
| `build.js` | ✅ как есть | esbuild → IIFE → AMD-обёртка → zip. Рабочий (zip 13 КБ собирался). |
| `package.json` + `package-lock.json` | ✅ как есть | esbuild + archiver, Node ≥ 18. |
| `.gitignore` | ✅ как есть | node_modules/dist/логи. |

### НЕ скопировано (и почему)

| Что | Почему |
|---|---|
| `raw/toolkeeper-looker-0.1.0/` | Распакованный артефакт сборки 0.1.0 (manifest идентичен source) — пересобирается из `reuse/source/` командой `npm run build`. |
| `source/releases/toolkeeper-looker-0.1.0.zip` | Тот же артефакт. |
| `raw/toolkeeper-looker-handoff.tar.gz` | Дубль распакованного handoff. |
| `__MACOSX/`, `.DS_Store` | macOS-мусор. |

## Чего в handoff НЕТ (создавать с нуля)

1. **Конвертер `amo-preview-converter`** (Node/FastAPI + LibreOffice headless, docker) — есть только контракт в plan.md и клиент `legacy.js`.
2. **vendor/** — пуст; скачать docx-preview@0.3.5 и xlsx@0.18.5 (команды в handoff_README).
3. **Тесты** — нет ни одного; фикстуры уже начаты нами в `work_directory/tests/fixtures/`.
4. Инфраструктура dev-бокса: nginx vhost `amo-conv.toolkeeper.io`, LE-сертификат, DNS (нужны доступы от Михаила).

## Поправки к handoff_plan.md по результатам нашей разведки (2026-06-10)

- ❗ `fetch(..., {credentials:'include'})` из plan.md (строка 111) **не работает** — проверено: «Failed to fetch» на редиректе с `ACAO:*`. Рабочий рецепт: `credentials:'same-origin'`. Fallback на `crm_post()` не требуется.
- Шаг 0 выполнен: селекторы сняты с живого кабинета `venskons78.amocrm.ru` (не toolkeeper) — см. `work_directory/01_specs/01_dom_recon_amocrm.md`.
- URL вложений имеют 2 формата (постоянный same-origin и временный подписанный drive-a) — оба покрываются одним рецептом fetch.
- Разметка вложений в ленте униформна, иконок по типам нет — упрощает инъекцию.
