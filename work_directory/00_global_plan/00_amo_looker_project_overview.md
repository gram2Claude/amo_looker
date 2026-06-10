# Проект amo_looker — обзор по материалам handoff

> Составлено 2026-06-10 по изучению `raw/` (handoff-пакет `nexus-looker`).
> Источники: `raw/nexus-looker-handoff/.../README.md` (передаточная записка),
> `plan.md` (полный план шагов 0–8), исходники `source/`, собранный виджет
> `raw/nexus-looker-0.1.0/` (распакованный zip v0.1.0).

## 1. Что это за проект

**Nexus Looker** — приватный виджет для amoCRM (аккаунт `toolkeeper.amocrm.ru`).
Добавляет кнопку-«глазик» рядом с каждым файлом в чате / примечании / письме карточки сделки
и открывает **предпросмотр файла в модалке без скачивания**.

**Зачем:** заменить покупной виджет **CatCode Looker**, который тарифицируется по числу
пользователей аккаунта (платят за десятки, реально пользуются несколько человек).
Свой виджет = те же возможности без подушной оплаты.

**Ограничение рамок:** только один аккаунт, Marketplace amoCRM не планируется.
Виджет приватный (`installation: false`), заливается вручную zip-архивом через
Настройки → Интеграции.

**Контакт владельца:** Михаил, `foringella@gmail.com` — доступы в amoCRM и на dev-бокс.

## 2. Архитектура (3 компонента)

1. **Виджет (фронт)** — zip с `manifest.json` (interface_version 2, locations:
   `lcard-1`, `ccard-1`, `comcard-1`, `advanced_settings`), AMD-бандл `script.js`,
   `style.css`, i18n ru/en, 5 PNG-логотипов. Работает DOM-инъекцией: код исполняется
   прямо в окне amoCRM (не в iframe), MutationObserver на фид карточки врезает глазик
   рядом с файлами. Байты файла берутся `fetch(href, {credentials:'include'})` —
   та же origin-сессия пользователя, токены не нужны.
2. **Конвертер `amo-preview-converter`** (НЕ существует) — микросервис Node/Python +
   LibreOffice headless в docker на dev-боксе `5.188.31.210`, домен
   `amo-conv.toolkeeper.io`. Контракт: `POST /convert` (octet-stream + заголовки
   `X-Filename`, `X-Source-Token`) → PDF. Для legacy-форматов (.doc/.xls/.ppt/.pptx/.rtf/.odt).
3. **Сборка** — `npm run build` (`build.js`): esbuild → IIFE → AMD-обёртка
   `define(["jquery"], ...)` → копия статики → zip в `releases/`.

**Роутинг рендереров по расширению** (`src/fileUtils.js` → `src/renderers/*`):

| Форматы | Renderer | Реализация |
|---|---|---|
| pdf | `pdf.js` | `<iframe>` (нативный браузер; pdf.js — запасной вариант) |
| jpg/jpeg/png/gif/webp/svg | `image.js` | `<img>` |
| txt/csv/json/md/log | `text.js` | `<pre>`, лимит 2 МБ |
| docx | `docx.js` | docx-preview из `vendor/` (lazy `<script>`) |
| xlsx | `xlsx.js` | SheetJS из `vendor/` (lazy), табы листов, лимит 10 МБ |
| doc/xls/ppt/pptx/rtf/odt/ods/odp | `legacy.js` | POST на конвертер → PDF → pdf-renderer |
| прочее | fallback | «не поддерживается → Скачать» |

## 3. Что уже сделано (шаг 1 плана — скаффолд)

- **Полный каркас виджета** в `source/`: `manifest.json`, ES-модули `src/`
  (`script.js` — entry с callbacks render/init/bind_actions/destroy; `inject.js` —
  MutationObserver + врезка глазика с защитой от дублей `data-tk-injected`;
  `modal.js` — оверлей с шапкой (имя, Скачать, ×), Esc/клик-вне, обработка ошибок;
  `fileUtils.js`; 6 рендереров), `style.css` (~3 КБ), i18n ru/en (включая тексты
  ошибок), 5 PNG-плейсхолдеров правильных размеров.
- **Сборка работает**: `npm ci && npm run build` (Node ≥ 18, deps: esbuild + archiver) →
  `source/releases/nexus-looker-0.1.0.zip` (~13 КБ) — **собран и готов к заливке**
  в amoCRM. Распакованная копия сборки лежит в `raw/nexus-looker-0.1.0/`.
- **Качественные мелочи уже в коде**: `destroy()` отписывает observer и снимает
  listeners; настройки `converter_url`/`converter_token` читаются из
  `advanced_settings` (можно переопределить без пересборки); лимиты размера в
  text/xlsx; ленивые vendor-подгрузки не ломают сборку при пустом `vendor/`.

## 4. Что НЕ сделано (блокеры и план, шаги 0/2–8)

**Три блокера из передаточной записки:**

1. **Реальные DOM-селекторы** (`FILE_ROW_SELECTORS`, `FEED_ROOT_SELECTORS` в
   `src/inject.js`) — сейчас правдоподобные **плейсхолдеры**: у автора не было живого
   amoCRM. Пока не заменены по DevTools-снапшоту реального аккаунта — глазик не
   появится вовсе. **Первая задача** (шаги 0 и 2 плана; помечены как самые хрупкие —
   половина успеха).
2. **`source/vendor/` пуст** — скачать руками `docx-preview@0.3.5` и `xlsx@0.18.5`
   (точные curl-команды в README handoff), иначе DOCX/XLSX-предпросмотр выдаст ошибку.
3. **Конвертер legacy-форматов не существует** — поднять `amo-preview-converter`
   на dev-боксе `5.188.31.210` (docker + LibreOffice headless, nginx vhost
   `amo-conv.toolkeeper.io`, LE-сертификат, порт 127.0.0.1:8094 — проверить свободен ли).
   `src/renderers/legacy.js` уже написан против контракта из plan.md.

**Полный план шагов (из plan.md):**

| Шаг | Содержание | Статус |
|---|---|---|
| 0 | DOM-разведка на живом аккаунте (DevTools, селекторы файловых строк в чате/примечаниях/письмах) | ❌ |
| 1 | Каркас виджета, сборка zip, проверка установки | ✅ (кроме проверки установки на живом аккаунте) |
| 2 | DOM-инъекция глазика по реальным селекторам, без дублей при скролле/подгрузке | ❌ |
| 3 | Модалка + image/PDF/text (≈60% кейсов) | код написан, не проверен на живом amoCRM |
| 4 | DOCX + XLSX (vendor-libs) | код написан; vendor-файлы не скачаны |
| 5 | Конвертер на dev-боксе (docker + LO + nginx + DNS + LE) | ❌ |
| 6 | legacy-renderer через конвертер | код написан; сервиса нет |
| 7 | UX-доводка: loading, ошибки, адаптивность | частично в коде, не проверено |
| 8 | Релиз: 3–5 дней параллельно с CatCode → отключить CatCode | ❌ |

**Критерий готовности (из plan.md):** 10 end-to-end проверок на проде (DOCX, XLSX,
PDF, JPG, legacy .doc, txt/csv, тяжёлый XLSX → вежливый отказ, .heic → fallback,
10 переключений карточек без утечек observer'ов, чистое удаление виджета) +
curl-проверка конвертера; затем 3–5 дней параллельной работы с CatCode без жалоб →
отключение подписки CatCode.

## 5. Ключевые риски (зафиксированы автором плана)

- **DOM amoCRM меняется без объявлений** — defensive-селекторы, feature-flag отключения
  в `advanced_settings`, ежемесячный smoke-чек.
- **CORS для `drive.amocrm.com`** — fallback на `this.crm_post()` (прокси amoCRM) или
  endpoint `/proxy` на конвертере.
- **Большие XLSX блокируют UI** — лимит 10 МБ (уже в коде).
- **LibreOffice: RCE-история и файл-блок** — non-root контейнер, очистка tmp,
  очередь `p-limit(4)`, rate-limit по shared-secret, без логирования содержимого файлов.
- **Конфликт с CatCode на переходный период** — работать параллельно, потом отключить.

## 6. Полезные факты для разработки

- В `toolkeeper-yii2` есть server-to-server интеграция amoCRM (`AMOCRM_TOKEN` и пр.) —
  **виджету она не нужна** и переиспользовать оттуда ничего не надо.
- Обновление виджета: bump `version` в manifest → пересборка → переустановка zip
  (auto-update у приватных виджетов amoCRM нет).
- Установка: amoCRM → Настройки → Интеграции → Создать интеграцию → Загрузить виджет →
  подтвердить стандартное предупреждение о стороннем коде.
- Handoff-репозитория не было (папка не под git) — репо заведено нами:
  `github.com/gram2Claude/amo_looker` (master защищён, рабочая ветка `oleg`).

## 7. Карта артефактов в `raw/`

| Путь | Что это |
|---|---|
| `raw/nexus-looker-handoff/.../README.md` | передаточная записка (готово / не готово / как собрать и залить) |
| `raw/nexus-looker-handoff/.../plan.md` | полный план: контекст, факты про виджеты amoCRM, архитектура, шаги 0–8, риски, верификация |
| `raw/nexus-looker-handoff/.../source/` | исходники виджета (см. §3) |
| `raw/nexus-looker-handoff/.../source/releases/nexus-looker-0.1.0.zip` | собранный артефакт для заливки в amoCRM |
| `raw/nexus-looker-0.1.0/` | тот же артефакт в распакованном виде (AMD-бандл v0.1.0) |
| `raw/nexus-looker-handoff.tar.gz` | исходный архив handoff |
