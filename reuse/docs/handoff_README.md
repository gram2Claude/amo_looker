# Toolkeeper Looker — amoCRM widget (передача)

Приватный виджет для amoCRM (`toolkeeper.amocrm.ru`): добавляет кнопку-«глазик» рядом с файлом в чате/примечании/письме сделки → открывает предпросмотр в модалке без скачивания. Делается, чтобы заменить покупной **CatCode Looker** (тарифицируют по числу юзеров аккаунта, у нас платят за многих, пользуется виджетом несколько).

Маркетплейс не планируется, только наш один аккаунт.

## Что готово

- Скаффолд виджета в `source/`: `manifest.json`, ES-модули в `src/` (script, inject, modal, fileUtils + 6 рендереров pdf/image/text/docx/xlsx/legacy), `style.css`, i18n ru/en, 5 PNG-плейсхолдеров правильных размеров
- Сборка `npm run build` (esbuild → IIFE → AMD-обёртка → zip)
- `source/releases/toolkeeper-looker-0.1.0.zip` (~13 KB) — собран, готов к заливке в amoCRM

## Что НЕ готово

1. **Селекторы DOM в `src/inject.js`** (`FILE_ROW_SELECTORS`, `FEED_ROOT_SELECTORS`) — placeholders, потому что у автора не было живого amoCRM под рукой. Пока не заменены — глазик не появится. **Первая задача нового разработчика.**
2. **vendor-libs.** Папка `source/vendor/` пустая. Скачать руками для DOCX/XLSX рендереров:
   ```bash
   curl -L -o source/vendor/docx-preview.min.js https://unpkg.com/docx-preview@0.3.5/dist/docx-preview.min.js
   curl -L -o source/vendor/xlsx.full.min.js    https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js
   ```
3. **Конвертер для legacy `.doc/.xls/.ppt/.pptx`** не существует. Это отдельный микросервис (Node + LibreOffice headless в docker), который надо поднять на dev-боксе `5.188.31.210` под доменом `amo-conv.toolkeeper.io`. Контракт endpoint'а — в `plan.md` шаг 5. `src/renderers/legacy.js` уже написан против этого контракта.

## Как собрать

```bash
cd source
npm ci
npm run build
# → source/releases/toolkeeper-looker-0.1.0.zip
```

Требования: Node.js ≥ 18.

## Как залить в amoCRM

amoCRM → Настройки → Интеграции → +Создать интеграцию → Загрузить виджет → выбрать zip → подтвердить «Внимание! сторонний код...» (это стандартное предупреждение для приватных виджетов, нормально).

## План

Полный план шагов 0–8 в `plan.md`. Резюме: шаг 1 (скаффолд) готов, дальше — шаг 2 (реальные DOM-селекторы), 3–4 (рендереры PDF/DOCX/XLSX), 5–6 (конвертер для legacy), 7 (UX), 8 (релиз + 3–5 дней параллельно с CatCode → отключаем CatCode).

## Репо

Локальная папка не под git, GitHub-репо не создавался — закрывать нечего. Заводите свой репо под своим аккаунтом.

## Контакт

`foringella@gmail.com` (Михаил, владелец) — для доступов в amoCRM и на dev-бокс.
