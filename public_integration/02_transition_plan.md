# План перехода Nexus Looker: private → публичная интеграция amoCRM

**Версия:** v2 (после ревью агентом и codex — `03_plan_review_log.md`)
**Спецификация:** `01_spec.md` | **Ветка:** `oleg`; merge в `master` через merge-гейт.

## Этап 0. Подготовка
- [ ] 0.1 Ветка `oleg` актуальна, дерево чистое; `npm ci && npm test` — зелёная база.

## Этап 1. Виджет (спека W1–W5)
- [ ] 1.1 `markdown-it` в `dependencies` (+lockfile, `npm ci`); статический import в
      `markdown.js`; удалить `src/vendorLoader.js`, `test/vendorLoader.test.js`, `vendor/`.
- [ ] 1.2 `build.js`: убрать копирование vendor; **build-guard** (fail-fast: createElement('script'),
      eval(, new Function, alert(, confirm( в бандле; `*.min.*`/vendor в dist).
- [ ] 1.3 `manifest.json`: `"settings": {}`, версия 0.2.0.
- [ ] 1.4 Выпил токена и settings-оверрайдов: `legacy.js`, `office.js` (эндпоинты —
      константы), `modal.js`/`script.js` — `settings`/`getSettings` из контракта рендереров.
- [ ] 1.5 Локализация: ключи `eye.tooltip`, `image.default_name`, `units.mb`,
      `errors.rate_limited` (ru+en); проброс переводов в `Injector`; `loader.js` юнит
      размера через i18n; 429 → `rate_limited` в office/legacy; en.json — кавычки, парность.
- [ ] 1.6 Чистка: мёртвые стили `.nx-render-docx*`/`.nx-xlsx-*`/`.nx-render-xlsx`;
      обновить CLAUDE.md (vendorLoader, контракт рендереров) и README.
- [ ] 1.7 Тесты: обновить inject (тултип из langs), loader; `npm test`; `npm run build`;
      grep dist: нет `createElement("script")`, нет `.min.*`.

## Этап 2. Конвертер (спека C1–C4)
- [ ] 2.1 Рефакторинг: `converter/app.js` — `createApp({ convert })`; `server.js` — entry.
- [ ] 2.2 `requireAuth` (Origin-паттерн ИЛИ токен) → `req.auth`; **in-handler проверки
      (бывш. server.js:85,127) перевести на `req.auth`**; гейт ДО `express.raw`.
- [ ] 2.3 Лимиты: глобальный inflight-кап (503) ДО raw; rate-limit окно 60с по двум
      ключам origin+ip (`trust proxy`); map с капом/очисткой; OPTIONS вне лимита.
- [ ] 2.4 CORS: отражение Origin по паттерну; `Vary: Origin`; убрать `X-Source-Token`
      из Allow-Headers; error-middleware (413) сохраняет CORS.
- [ ] 2.5 `PREVIEW_TTL_MS` дефолт 5 мин; новые env в `converter/.env.example`/compose;
      nginx: `/preview/` no-store + noindex + nosniff; `limit_req`/`client_max_body_size`
      проверить как явный пункт.
- [ ] 2.6 Автотесты (vitest+supertest, DI convert-мок): матрица auth (валидный/вложенный
      поддомен/evil.com/порт/http/нет Origin; токен), 429 origin и ip, 503 inflight,
      CORS POST/OPTIONS/413, нет буферизации без auth. `node -c` обоих файлов.

## Этап 3. Материалы (спека §6)
- [ ] 3.1 `site/`: privacy_ru/en.html + support_ru/en.html (плейсхолдеры реквизитов).
- [ ] 3.2 `market/`: описания до/после × ru/en (раскрытие Microsoft, ссылки на политику).
- [ ] 3.3 Тур 1188×616: ≥3 макета × ru/en (черновик; чек-лист — заменить реальными
      скриншотами до подачи).
- [ ] 3.4 Письмо в техподдержку amoCRM: врезка в ленту И модалка-оверлей; вопросы о
      допустимости; запрос рекомендаций.
- [ ] 3.5 Чек-лист подачи: ru-маркет; **отдельный раздел Kommo** (аккаунт, форма, en-материалы,
      требования формы — выяснить); проверка `settings:{}` загрузкой; реальные Origin;
      доменная почта; реквизиты в политику; реальные скриншоты тура.

## Этап 4. Деплой (на сервере; СТРОГО до раскатки виджета — sequencing из ревью)
- [ ] 4.1 Конвертер: залить, `docker compose up -d --build`; обратная совместимость
      (токен работает) — старый виджет 0.1.0 не ломается.
- [ ] 4.2 nginx: заголовки `/preview/`, статика политики/поддержки; проверить URL по https.
- [ ] 4.3 curl-матрица 2.6 на проде (+ OPTIONS preflight, 413 c CORS).
- [ ] 4.4 Пересобрать виджет 0.2.0, обновить widget-host статику; boot.js без токена.
- [ ] 4.5 Smoke на venskons78 (букмарклет): pdf, картинка, md (инлайн-markdown-it!),
      docx (viewer), .doc (legacy), csv; загрузка zip 0.2.0 — валидатор manifest.

## Этап 5. Ревью и приёмка
- [ ] 5.1 Ревью кода независимым агентом; фиксы.
- [ ] 5.2 Ревью через codex; фиксы.
- [ ] 5.3 Security-review (инварианты §7, риски §8); без HIGH/MEDIUM вне принятых.
- [ ] 5.4 Merge-гейт `oleg` → `master`.
- [ ] 5.5 Отчёт владельцу + список «перед подачей» (реквизиты, почта, скриншоты, ответ amo).

## Порядок
1 ∥ 2 ∥ 3 (независимы) → 4 (сервер раньше виджета!) → 5.
Письмо 3.4 готовится сейчас; отправка — решение владельца.

## Откат
Сервер: токен-путь сохранён → старые клиенты живут; откат = прежний docker-образ.
Виджет: zip 0.1.0 в `releases/` устанавливается поверх; работает против нового сервера
(токен валиден) и старого.
