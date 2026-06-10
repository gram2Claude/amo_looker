# План: собственный amoCRM-виджет «глазик-предпросмотр» (замена CatCode Looker)

## Контекст

У команды есть проблема в amoCRM: к карточкам/чатам/примечаниям/письмам прикрепляются документы (КП в .docx, сметы в .xlsx, PDF, картинки), но amoCRM не умеет показывать их inline — только скачивать. CatCode Looker решает это виджетом «глазик» рядом с каждым файлом, но тарифицирует за всех пользователей аккаунта (а реально пользуется ~несколько человек из десятков). Цель — свой виджет с теми же возможностями, без CatCode и без подушной тарификации.

**Технические решения** (зафиксированы по вопросам выше):
- Гибрид: клиентский рендеринг через JS-библиотеки + лёгкий LibreOffice-конвертер на dev-боксе (5.188.31.210) для legacy-форматов
- Поддерживаемые форматы: PDF, картинки (jpg/png/gif/webp), DOCX, XLSX, .doc/.xls/.ppt/.pptx (legacy), TXT/CSV/JSON/MD
- Новый отдельный репо `toolkeeper-amo-widget` (фронт виджета). Бэкенд-конвертер живёт в `toolkeeper-yii2` как отдельный модуль/мс рядом с дев-инфрой

## Что мы знаем про amoCRM-виджеты (опорные факты)

- Виджет = `.zip` с `manifest.json`, `script.js`, `i18n/`, `images/` (5 PNG), `style.css`, опционально `templates/`. Заливается в **Настройки → Интеграции → Создать интеграцию → загрузить виджет**.
- Приватный виджет (`installation: false` или Settings-only) ставится только на один аккаунт. Marketplace не нужен.
- `interface_version: 2`, `locations` — список зон. Для нашей задачи: **`lcard`, `ccard`, `comcard`** (карточки лида/контакта/компании, где живут чаты/примечания/письма) + опционально **`advanced_settings`** для своей страницы настроек. Нет специального location «attachment» — Looker и аналоги работают **DOM-инъекциями** из карточных локаций.
- В `script.js` есть callbacks: `render` → `init` → `bind_actions` → `destroy`. Каждый должен вернуть `true`. Доступны: `this.system()`, `this.langs`, `this.get_settings()`, `this.crm_post()` (прокси для HTTP в обход CORS), `this.render_template()`.
- **Код виджета исполняется в том же окне amoCRM** (не в sandboxed iframe), jQuery подключён, DOM amoCRM полностью доступен. Это и есть приём, на котором делают «глазик».
- `destroy` обязателен для отписки наблюдателей и отключения слушателей при переходе между карточками.

Ссылки на доки (на дальше): kommo.com developers (manifest, locations, script.js, widget tutorial).

## Что есть в коде уже сейчас

(Из разведки `/Users/foringella/expo2/toolkeeper-yii2`.)

- `.env.default` строки 40–52: `AMOCRM_BASE_URL` (= `https://toolkeeper.amocrm.ru`), `AMOCRM_TOKEN` (long-lived JWT). Это **server-to-server** интеграция для лидов, **не виджет**. Виджету этот токен **не нужен** — он работает в окне amoCRM в авторизованной сессии пользователя.
- `components/AmoCrmClient.php`, `services/AmoCrmSyncService.php`, `commands/AmoController.php` — текущая интеграция лидов. **Переиспользовать ничего отсюда не нужно**, виджет принципиально другой инструмент.
- `modules/api/services/FileStorageService.php` — Selectel S3-обёртка (`https://s3.ru-1.storage.selcloud.ru`, bucket `inventory`). Не используется, файлы виджет берёт прямо с CDN amoCRM (`https://*.amocrm.ru/download/...` или `https://drive-*.amocrm.com/...`) внутри сессии пользователя.

## Архитектура (три компонента)

### 1. Виджет — `toolkeeper-amo-widget` (новый репо)

Структура:
```
toolkeeper-amo-widget/
  manifest.json
  script.js             # AMD-модуль, главная логика
  style.css             # стили глазика и модалки
  i18n/
    ru.json
    en.json
  images/
    logo.png            # 5 PNG: logo, logo_small, ...
    ...
  vendor/               # минифицированные cdn-libs для оффлайн-инсталла
    pdf.min.js          # pdf.js
    docx-preview.min.js
    xlsx.full.min.js    # SheetJS
  src/                  # исходники до сборки
    inject.js           # MutationObserver + врезка глазика
    modal.js            # модалка-вьювер
    renderers/
      pdf.js
      image.js
      docx.js
      xlsx.js
      text.js
      legacy.js         # дёргает конвертер на dev-боксе
    fileUtils.js        # detect mime by url+extension
  build.js              # склейка в script.js + zip
  package.json
  README.md
```

**`manifest.json`** (минимум):
```json
{
  "widget": {
    "name": "widget.name",
    "description": "widget.description",
    "short_description": "widget.short_description",
    "version": "0.1.0",
    "interface_version": 2,
    "init_once": false,
    "locale": ["ru", "en"],
    "installation": false,
    "locations": ["lcard-1", "ccard-1", "comcard-1", "advanced_settings"],
    "support": { "email": "support@toolkeeper.io" }
  }
}
```

`init_once: false` — мы хотим, чтобы `init/bind_actions` отрабатывали на каждое открытие карточки (новые файлы появляются динамически). `destroy` отписывает observer при уходе.

**`script.js`** — алгоритм:
1. `render()`: подключить локальный CSS, лениво подгрузить `vendor/*` при первой потребности (через AMD `require`), вернуть `true`.
2. `init()`: запомнить `area = this.system().area`, повесить **MutationObserver на feed-контейнер** (карточный фид: `.feed-compose-attach`, `.feed__item__attach`, `.task-detail__notes-attach`, `.feed-note__attach-file`, `.notes-wrapper [data-id]`, `email-message [class*="attach"]` — точные селекторы зафиксировать **по DOM-снапшоту реального аккаунта**, шаг 0 ниже). Возврат `true`.
3. На каждое новое сообщение/примечание/письмо: пройтись по файловым строкам, для каждой:
   - распознать mime/ext по `href` или `data-` атрибуту;
   - воткнуть `<span class="tk-eye" data-href="..." data-name="...">👁</span>` (svg-иконка как у CatCode) рядом с именем файла;
   - пометить `data-tk-injected="1"`, чтобы избегать дубликатов.
4. `bind_actions()`: делегированный клик по `.tk-eye` → открыть модалку, вызвать соответствующий renderer.
5. `destroy()`: `observer.disconnect()`, снять делегированный listener, закрыть открытые модалки.

**Модалка** (`src/modal.js`): полноэкранный оверлей в z-index выше amoCRM, шапка (имя файла, кнопки «Скачать» и «Закрыть», навигация ←/→ если хотим листать вложения карточки), тело — площадка под renderer. Esc/клик-вне закрывают.

**Роутер renderer'ов** (`src/renderers/*`) — по mime/ext:

| Расширение                  | Renderer        | Технология                            |
|-----------------------------|------------------|---------------------------------------|
| `.pdf`                      | `pdf.js`        | pdf.js (Mozilla), canvas-страницы     |
| `.jpg/.png/.gif/.webp/.svg` | `image.js`      | `<img>` с zoom                        |
| `.docx`                     | `docx.js`       | docx-preview (npm)                    |
| `.xlsx`                     | `xlsx.js`       | SheetJS Community → HTML-таблица      |
| `.txt/.csv/.json/.md`       | `text.js`       | `<pre><code>` + Prism                 |
| `.doc/.xls/.ppt/.pptx`      | `legacy.js`     | POST файла на конвертер → ответный PDF → pdf.js |
| прочее                      | fallback        | «Формат не поддерживается → Скачать»  |

**Получение байтов файла**: `fetch(href, { credentials: 'include' })`. Виджет крутится в том же origin, что amoCRM-UI, → cookies прикладываются автоматически, доп. авторизация не нужна. На всякий случай — fallback на `crm_post()` если CORS-prefetch для drive.amocrm.com не сработает.

### 2. Конвертер `amo-preview-converter` — на dev-боксе (5.188.31.210)

Минимальный HTTP-сервис, докер-контейнер с `libreoffice --headless` (~ 700 МБ образ, ~400 МБ RAM в простое). Endpoint:

```
POST https://amo-conv.toolkeeper.io/convert
Content-Type: application/octet-stream
X-Filename: kp.doc
X-Source-Token: <shared secret из env>
Body: <бинарь файла>

→ 200 OK
Content-Type: application/pdf
Body: <PDF>
```

Реализация: Node.js (express + child_process) или Python (FastAPI + subprocess) — что проще, ~80 строк. Запускает `libreoffice --headless --convert-to pdf --outdir /tmp/<uuid> /tmp/<uuid>/in.ext`, отдаёт PDF, чистит /tmp.

- **Защита**: shared secret `X-Source-Token` в виджете и сервисе (через `widget settings → advanced_settings`, либо вшитый при сборке zip). Дополнительно — CORS allowlist на `*.amocrm.ru`, `*.amocrm.com`.
- **Лимиты**: размер файла ≤ 50 МБ, таймаут 30 с, очередь конкурентности 4.
- **Деплой**: `docker-compose.yml` рядом с другими сервисами на dev-боксе. nginx vhost `amo-conv.toolkeeper.io` → 127.0.0.1:8094 (свободный порт, проверить). Сертификат LE.
- **Логи**: stdout → docker, в Sentry **не отправляем** (виджет — best effort, без observability v1).

Образ: `linuxserver/libreoffice` или собственный `FROM debian:bookworm-slim` + `apt-get install -y libreoffice-core libreoffice-writer libreoffice-calc libreoffice-impress fonts-dejavu`. Не ставить полный libreoffice — только нужные модули.

Этот сервис **отдельно от toolkeeper-yii2**. Положить как поддиректорию в `/Users/foringella/expo2/amo-preview-converter/` (новый репо `toolkeeper-io/amo-preview-converter`).

### 3. Сборка и поставка виджета

- `build.js`: склеивает `src/*` через esbuild или rollup в `script.js`, минифицирует, копирует `vendor/`, `i18n/`, `images/`, `manifest.json`, `style.css` в `dist/`, упаковывает в `dist/toolkeeper-looker-1.0.0.zip`.
- `npm run build` локально, артефакт коммитится в `releases/` (или релизом через GitHub Releases) — у amoCRM нет URL-инсталла, только ручная загрузка zip.
- **Поставка**: открыть toolkeeper.amocrm.ru → Настройки → Интеграции → Создать интеграцию → «Загрузить виджет» → выбрать zip → подтвердить. Виджет применится на всех пользователей аккаунта (или на конкретных, если поставить chooser в advanced_settings).
- **Обновления**: новый zip с большей `version` → переустановка через тот же интерфейс. amoCRM не делает auto-update для приватных виджетов.

## Файлы, которые предстоит создать/изменить

| Путь                                                                | Что                                       |
|---------------------------------------------------------------------|-------------------------------------------|
| `toolkeeper-amo-widget/manifest.json`                               | манифест виджета                          |
| `toolkeeper-amo-widget/script.js` (build artifact из `src/`)        | главная JS-логика                         |
| `toolkeeper-amo-widget/src/inject.js`                               | MutationObserver + врезка глазика         |
| `toolkeeper-amo-widget/src/modal.js`                                | модалка-вьювер                            |
| `toolkeeper-amo-widget/src/renderers/{pdf,image,docx,xlsx,text,legacy}.js` | дисптачер на формат                |
| `toolkeeper-amo-widget/src/fileUtils.js`                            | mime/ext-детект                           |
| `toolkeeper-amo-widget/style.css`                                   | стили глазика и модалки                   |
| `toolkeeper-amo-widget/i18n/{ru,en}.json`                           | переводы (название виджета, кнопки)       |
| `toolkeeper-amo-widget/images/*.png`                                | 5 логотипов (можно SVG → PNG из текущих ассетов toolkeeper) |
| `toolkeeper-amo-widget/vendor/*`                                    | минифайды pdf.js, docx-preview, SheetJS   |
| `toolkeeper-amo-widget/build.js` + `package.json`                   | сборка                                    |
| **`amo-preview-converter/` (отдельный репо)**                       |                                            |
| `amo-preview-converter/server.js`                                   | HTTP-сервер `/convert`                    |
| `amo-preview-converter/Dockerfile`                                  | libreoffice headless                      |
| `amo-preview-converter/docker-compose.yml`                          | для dev-бокса                             |
| `amo-preview-converter/README.md`                                   | инструкция по деплою                      |
| **dev-бокс (5.188.31.210)**                                         |                                            |
| `/root/compose.yml` (или новый stack)                               | добавить сервис amo-conv + nginx vhost    |
| nginx vhost `amo-conv.toolkeeper.io.conf`                           | прокси на 127.0.0.1:8094, LE-сертификат   |

## Шаги реализации

**Шаг 0 — DOM-разведка (без кода)**. На toolkeeper.amocrm.ru открыть лидовую карточку с разными типами вложений (чат, примечание, письмо). DevTools → скопировать селекторы файловых строк. Зафиксировать в `src/inject.js` как **константы** с комментариями про хрупкость. Это половина успеха — без точных селекторов MutationObserver промахнётся.

**Шаг 1 — каркас виджета**. Создать репо, написать `manifest.json` (interface_version 2, locations lcard-1/ccard-1/comcard-1/advanced_settings), `script.js` с пустыми callbacks возвращающими `true`, иконки + i18n. Собрать zip, залить на toolkeeper.amocrm.ru, убедиться, что виджет ставится и показывает иконку в карточке.

**Шаг 2 — DOM-инъекция глазика**. Реализовать `src/inject.js`: MutationObserver на feed-контейнер, врезка `<span class="tk-eye">` рядом с каждым файлом. По клику пока — `alert(href)`. Проверить, что глазик появляется на чате/примечаниях/письмах **и не дублируется** при скролле/подгрузке.

**Шаг 3 — модалка + image/PDF/text**. `src/modal.js` + renderers для image, pdf, txt/json/md. Это покроет ~60% реальных кейсов и валидирует архитектуру. Загрузка файла через `fetch(href, {credentials: 'include'})`.

**Шаг 4 — DOCX + XLSX**. Подключить docx-preview и SheetJS как `vendor/`, реализовать рендереры. Тестовая выборка — реальные КП из их сделок (пример из скриншота — «26с156 КП Burberry 2 этаж ДЛТ РД монтаж СПС СОУЭ ВПТ.docx»).

**Шаг 5 — Конвертер на dev-боксе**. Поднять `amo-preview-converter` (Node + LibreOffice в docker). Завести `amo-conv.toolkeeper.io` (DNS + nginx vhost + LE). Проверить из CLI `curl --data-binary @test.doc https://amo-conv.toolkeeper.io/convert -H "X-Source-Token: ..."`.

**Шаг 6 — legacy renderer**. `src/renderers/legacy.js` шлёт байты на `amo-conv`, получает PDF, передаёт в pdf.js-renderer.

**Шаг 7 — UX и доводка**. Скачать-кнопка в модалке. Esc/клик-вне. Адаптивность. Loading-state. Сообщения об ошибках (превышен размер / неподдерживаемый формат). Маленькие телеметрические хуки (опционально).

**Шаг 8 — Релиз**. Bump version → `npm run build` → zip. Поставить на toolkeeper.amocrm.ru поверх существующего виджета. Через 1–2 дня — отключить CatCode Looker в их подписке (Настройки → Интеграции → Looker → Отключить).

## Риски и митигации

- **DOM amoCRM меняется без объявлений**. Шаги 0 и 2 — самые хрупкие. Митигация: defensive-селекторы (несколько вариантов через `|`), feature-flag «отключить виджет» в `advanced_settings` на случай поломки, ежемесячный smoke-чек.
- **CORS для drive.amocrm.com**. Если `fetch credentials: 'include'` не сработает с drive-доменом — fallback через `this.crm_post()` (прокси Kommo) или маленький прокси на dev-боксе (тот же `amo-conv` контейнер с лишним endpoint `/proxy?url=...`).
- **Большие XLSX (>10 МБ)** в SheetJS могут блокировать UI. Митигация: лимит размера 10 МБ, выше — fallback на «открыть в новой вкладке» + (опционально) конвертацию в PDF через сервер.
- **Конкурентность LibreOffice**. Один процесс LO держит файл-блок; нужна очередь. Митигация: `p-limit(4)` + warm-up workers, при перегрузке — 429.
- **Безопасность конвертера**. LibreOffice печально известен RCE через сложные документы. Митигация: запуск под non-root в контейнере, `--norestore --nodefault --nofirststartwizard`, удаление tmp-директорий, рейт-лимит по shared-secret. Прод-данные клиентов уходят через этот сервис → сервис **на dev-боксе всё равно прод-доступный** — это ОК, но без логирования содержимого файлов.
- **Конфликт с CatCode на время перехода**. Митигация: на проде сначала параллельно (оба глазика разных цветов), убедиться что наш не падает, потом отключить CatCode.

## Верификация

End-to-end (после шага 8, до отключения CatCode):

1. Открыть лидовую карточку с прикреплённым **DOCX** (КП Burberry или любой свежий). Нажать наш глазик → DOCX рендерится в модалке без скачивания. ✓
2. То же на **XLSX** (смета). ✓
3. То же на **PDF** (прайс). ✓
4. То же на **JPG/PNG** (фото объекта). ✓
5. Найти примечание со старым **.doc** или **.xls** → конвертер на dev-боксе вернул PDF, отрендерилось в pdf.js. ✓
6. Прикрепить **.txt/.csv** через тестовое примечание → отрендерилось как `<pre>`. ✓
7. Открыть **тяжёлый XLSX 20 МБ** → корректное сообщение «слишком большой, скачайте файл». ✓
8. Открыть **картинку формата .heic** (неподдерживаемый) → fallback «Скачать». ✓
9. Переключиться между карточками 10 раз подряд → нет утечек observer'ов (DevTools → Memory → проверить detached nodes). ✓
10. Снести виджет через Настройки → Интеграции → глазик пропал отовсюду, никаких остатков в DOM. ✓

Проверки конвертера:

```
curl -s --data-binary @test.doc \
  -H "X-Filename: test.doc" \
  -H "X-Source-Token: $TOKEN" \
  https://amo-conv.toolkeeper.io/convert > out.pdf && file out.pdf  # → PDF document
```

Готово к снятию подписки CatCode после прохождения всех 10 шагов на проде в течение 3–5 дней без жалоб.
