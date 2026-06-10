# Nexus Looker — amoCRM widget

Собственный виджет «глазик» для amoCRM (замена CatCode Looker). Добавляет рядом с каждым файлом в чате/примечаниях/письмах кнопку предпросмотра — открывает модалку без скачивания файла.

## Поддерживаемые форматы

| Формат                                | Renderer        | Реализация                     |
|---------------------------------------|------------------|--------------------------------|
| PDF                                   | `pdf.js`        | `<iframe>` (нативный браузер)  |
| jpg / png / gif / webp / svg          | `image.js`      | `<img>`                        |
| txt / csv / json / md / log           | `text.js`       | `<pre>`                        |
| docx                                  | `docx.js`       | docx-preview (vendor/)         |
| xlsx                                  | `xlsx.js`       | SheetJS Community (vendor/)    |
| doc / xls / ppt / pptx / rtf / odt    | `legacy.js`     | бэк-конвертер (LibreOffice) → PDF |

## Структура

```
manifest.json     # объявление виджета для amoCRM
style.css         # стили глазика и модалки
i18n/             # ru.json, en.json
images/           # 5 PNG-логотипов (заглушки, нужны нормальные)
src/              # ES-модули
  script.js       # entry point
  inject.js       # MutationObserver + врезка глазика
  modal.js        # модалка-вьювер
  fileUtils.js    # detect kind by extension
  renderers/      # один файл на формат
vendor/           # минифайды docx-preview, SheetJS (положить руками)
build.js          # сборка → dist/ → releases/nexus-looker-X.Y.Z.zip
```

## Сборка

```bash
npm install
npm run build
```

Получаем `releases/nexus-looker-0.1.0.zip` — это и есть архив для загрузки в amoCRM.

## Установка (приватный виджет)

1. toolkeeper.amocrm.ru → **Настройки → Интеграции → Создать интеграцию**
2. Выбрать «Загрузить виджет», прикрепить `releases/nexus-looker-*.zip`
3. Подтвердить установку

Обновление: bump `version` в `manifest.json` → `npm run build` → переустановить zip через тот же интерфейс.

## Vendor-библиотеки

Положить вручную (один раз):

```bash
curl -L -o vendor/docx-preview.min.js  https://unpkg.com/docx-preview@0.3.5/dist/docx-preview.min.js
curl -L -o vendor/jszip.min.js         https://unpkg.com/jszip@3.10.1/dist/jszip.min.js
curl -L -o vendor/xlsx.full.min.js     https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js
```

Версии запинены намеренно (без пина unpkg отдаёт latest). jszip — runtime-зависимость docx-preview (нужен глобальный JSZip).

Они грузятся **лениво** при первом открытии docx/xlsx, поэтому отсутствие vendor/ не ломает сборку — просто эти форматы выдадут ошибку.

## Legacy-конвертер

`src/renderers/legacy.js` шлёт байты на `https://amo-conv.toolkeeper.io/convert` (см. репо `amo-preview-converter`). Endpoint и shared-token можно переопределить через `advanced_settings` виджета.

## Дальше по плану

См. `/Users/foringella/.claude/plans/fluffy-tumbling-sloth.md` — шаги 2 (DOM-инъекция со снапшота реального amoCRM), 5 (конвертер), 6–8 (доводка, релиз, отключение CatCode).
