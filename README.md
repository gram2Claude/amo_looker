# Nexus Looker — amoCRM widget

Виджет «глазик» для amoCRM: рядом с каждым файлом в примечаниях/чате/письмах появляется
кнопка предпросмотра — файл открывается в модалке без скачивания.
Готовится публикация в маркетплейсе amoCRM — спецификация и материалы в `public_integration/`.

## Поддерживаемые форматы

| Формат                          | Renderer      | Реализация                                          |
|---------------------------------|---------------|-----------------------------------------------------|
| PDF                             | `pdf.js`      | blob → `<iframe>` (нативный браузер)                |
| jpg / png / gif / webp / svg    | `image.js`    | blob → `<img>` (скрипты в svg не исполняются)       |
| txt / json / log                | `text.js`     | `<pre>` через `.text()`                             |
| md                              | `markdown.js` | markdown-it (`html:false`), инлайн в бандле         |
| docx / pptx / xlsx / csv        | `office.js`   | Microsoft Office viewer через наш `/preview-host` ⚠️ файл уходит к Microsoft |
| doc / xls / ppt / rtf / odt     | `legacy.js`   | наш конвертер (LibreOffice headless) → PDF          |

Маппинг расширение→рендерер — единственный источник: `src/fileUtils.js` (`EXT_TO_KIND`).

## Структура

```
manifest.json     # объявление виджета (widget/locations/settings); ЗДЕСЬ задаётся версия
style.css         # стили глазика и модалки (всё под префиксом .nx-)
i18n/             # ru.json, en.json (парные ключи)
images/           # 5 PNG-логотипов по размерам amoCRM
src/              # ES-модули
  script.js       # entry: фабрика amoCRM CustomWidget
  inject.js       # MutationObserver + врезка глазика (клик — capture на document)
  modal.js        # модалка-вьювер
  loader.js       # fetch-слой: same-origin, AbortController, objectURL-трекинг
  i18n.js         # makeT — lookup переводов
  fileUtils.js    # detect kind by extension
  renderers/      # один файл на тип
converter/        # серверный сервис (Express в Docker, nginx, Hetzner)
  app.js          # фабрика createApp({convert}) — auth (Origin/токен), лимиты, эндпоинты
  server.js       # entry: listen + TTL-уборка preview-файлов
  convert.js      # LibreOffice headless (kill process-tree, per-request профиль)
  deploy/         # nginx vhost, compose, заметки деплоя
build.js          # esbuild → AMD define(["jquery"]) → dist/ → releases/*.zip + build-guard
public_integration/  # спека, план, материалы маркетплейса (политика, описания, тур, чек-лист)
widget-host/      # boot.js для ручного теста букмарклетом на техническом аккаунте
```

## Сборка и тесты

```bash
npm install
npm test            # vitest: виджет (jsdom) + конвертер (supertest, без LibreOffice)
npm run build       # → releases/nexus-looker-<version>.zip (версия из manifest.json)
```

Build-guard валит сборку, если в бандле появились запрещённые для публичных
интеграций паттерны (`createElement('script')`, `eval`, `alert`, …) или в dist
попали минифицированные файлы.

## Конвертер (сервер)

`https://nexus-oko.naithon.one` — `/convert` (legacy→PDF), `/preview-host` (Office viewer),
`/widget/` (статика для букмарклета), `/preview/` (короткоживущие uuid-файлы, TTL 5 мин).
Авторизация: Origin кабинета amoCRM/Kommo или служебный токен; эшелон лимитов
(inflight-кап, rate-limit origin+ip, nginx limit_req). Детали — `converter/app.js` и CLAUDE.md.
