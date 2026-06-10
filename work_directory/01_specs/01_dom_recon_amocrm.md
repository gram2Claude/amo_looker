# DOM-разведка amoCRM: селекторы и механизм скачивания вложений

**Дата:** 2026-06-10
**Кабинет:** venskons78.amocrm.ru (аккаунт Михаил, № 33093102)
**Тестовая сделка:** `/leads/detail/3177663` («Looker DOM-разведка (тест)»)
**Метод:** живой кабинет, GStack Browser (headed Chromium + Playwright), загрузка 5 тестовых файлов (docx/xlsx/pdf/doc/xls) через ленту примечаний.

Снимает блокер №1 проекта (селекторы-плейсхолдеры в `inject.js`) и закрывает открытый вопрос «как скачать файл из виджета».

---

## 1. Селекторы ленты сделки

Цепочка DOM от ссылки файла вверх до ленты (снята с живой карточки):

```
A.feed-note__joined-attach__link.feed-note__blue-link      ← ссылка на файл (text = имя файла)
DIV.feed-note__joined-attach-item__content
DIV.feed-note__joined-attach-item                          ← строка вложения (точка инъекции глазика)
DIV.feed-note__joined-attach                               ← блок вложений примечания
DIV.feed-note__content
DIV.feed-note.feed-note-with-context
DIV.js-note.feed-note-fixer
DIV.feed-note-wrapper.feed-note-wrapper-note               ← обёртка примечания
DIV.notes-wrapper__notes.js-notes                          ← контейнер ленты (цель MutationObserver)
DIV.notes-wrapper__scroller-inner
DIV.notes-wrapper__scroller.custom-scroll
DIV.notes-wrapper
```

Рабочие селекторы для `inject.js`:

| Назначение | Селектор |
|---|---|
| Контейнер ленты (observer) | `.notes-wrapper__notes.js-notes` |
| Примечание-нота | `.feed-note-wrapper-note` |
| Строка вложения | `.feed-note__joined-attach-item` |
| Ссылка на файл | `a.feed-note__joined-attach__link` |

Нюансы:
- Разметка вложения **униформна для всех типов файлов** — иконок по расширению нет, тип определяем только по имени файла из текста/href ссылки.
- У ссылки `target="_blank"`, имя файла = `textContent`.
- Системные события ленты имеют другие модификаторы обёртки (`feed-note-wrapper-lead_created`, `-field_changed`) и `data-id` (ULID); у пользовательских нот `data-id` на обёртке нет.
- Лента рендерится в обычном DOM (не shadow), динамически — MutationObserver на `.js-notes` обязателен.
- Эталонный HTML: `work_directory/tests/fixtures/dom/feed_note_docx_full.html`, `attach_blocks_all.html`, `feed_container_and_attrs.txt`.

## 2. URL вложений — два формата

1. **Постоянный (после перезагрузки страницы), same-origin:**
   `https://<домен>.amocrm.ru/download/drive/<node_uuid>/<file_uuid>/<имя_файла>`
   Требует сессионную куку; отвечает 302-редиректом.

2. **Свежезагруженный файл (до перезагрузки страницы), подписанный:**
   `https://drive-a.amocrm.ru/download/<drive_id>/<file_uuid>/<имя>?sign=<JWT>`
   JWT живёт ~1 час (exp−iat = 3600с), `drive_id` постоянен для аккаунта. CORS: `ACAO` позволяет читать без кук.

Цепочка редиректов варианта 1: `amocrm.ru/download/drive/...` → (302) → `drive-a.amocrm.ru/...?sign=...` → (302) → **`hb.bizmrg.com/drive_prod/<content_id>`** (S3 VK Cloud, отдаёт тело с CORS).

## 3. Рецепт скачивания из виджета (проверено в живой странице)

```js
const resp = await fetch(link.href, { credentials: 'same-origin' });
const buf  = await resp.arrayBuffer();   // status 200, корректный content-type
```

- `credentials: 'same-origin'` — критично. Кука уходит только на первый same-origin хоп (авторизует редирект), на cross-origin хопы куки не шлются, поэтому `ACAO: *` финального хоста проходит.
- ❌ `credentials: 'include'` — ломается («Failed to fetch»): credentialed-запрос несовместим с `ACAO: *` на редиректе.
- Рецепт покрывает **оба** формата URL (для подписанного куки просто не нужны).
- Content-Type отдаётся честный (например, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`).

## 4. Загрузка файлов в ленту (для авто-тестов)

- Скрытый input: `#note-edit-attach-filenew` (`name=UserFile`, класс `js-form-changes-skip hidden`).
- Сабмит примечания: `button.js-note-submit` (виден после attach; клик через JS работает).
- Аплоад-флоу amo: `POST /ajax/v4/files/issue_token` → `drive-b.amocrm.ru/v1.0/sessions` → `POST drive-a.amocrm.ru/upload/<JWT>` → `POST /private/notes/edit2.php?parent_element_id=<lead_id>&parent_element_type=2`.
- ⚠️ Повторный attach без перезагрузки страницы ломает аплоадер (сессия создаётся, байты не уходят) — в авто-тестах перезагружать карточку между загрузками.

## 5. Тестовые данные

- Файлы: `work_directory/tests/fixtures/upload/` (test_doc.docx, test_table.xlsx, test.pdf, legacy.doc, legacy.xls, cors_probe.docx — содержимое плейсхолдерное, для рендереров понадобятся настоящие).
- Все 6 прикреплены к сделке 3177663 в venskons78.amocrm.ru.

## 6. Что осталось проверить позже

- Лента контактов/компаний (ожидаемо те же классы `feed-note__*`, не проверено).
- Вкладка/виджет «Файлы» карточки — вторичная точка инъекции (вне скоупа шага 2).
- Конфликт с глазиком CatCode — в этом кабинете CatCode не установлен, DOM чистый; вопрос к Михаилу о скриншоте остаётся.
- Поведение в ленте «Неразобранное» и в мобильной вёрстке.
