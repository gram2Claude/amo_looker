# Ревью: Office viewer + preview-host + markdown + svg + картинки (11.06)

Независимое ревью накопленного с E1S4: субагент (general-purpose) + codex (gpt-5.5). Диапазон: a0c3777~1..oleg — converter/server.js (/preview-host), office.js, markdown.js, image.js (svg), inject.js (картинки+capture-клик), fileUtils.js.

## Итог обоих ревьюеров
**P1-уязвимостей XSS/RCE/traversal НЕТ** — подтвердили оба независимо:
- markdown `html:false` + встроенный validateLink markdown-it → XSS через .md закрыт;
- svg только через `<img src=blob:image/svg+xml>` → скрипты не исполняются (проверено вживую: xss_fired=0);
- path traversal через X-Filename невозможен (имя на диске = randomUUID()+whitelisted ext, rawName на путь не влияет);
- capture-клик проверяет `closest('.nx-eye')` и не трогает чужие клики; листенеры/objectURL корректно снимаются.

## Расхождение приоритета (улажено)
DoS-устойчивость /preview-host: субагент=P1, codex=P2. Учитывая модель угроз (приватный виджет, токен у доверенных сотрудников) — ближе к P2, но фикс дешёвый → применён.

## Применённые фиксы (commit 6632c83)
1. **requireToken ДО express.raw** (/convert + /preview-host): без токена тело не буферизуется в RAM — анти-DoS по памяти. Проверено: без токена → 401.
2. **p-limit на запись preview-host** (csv-конвертация + writeFile): всплеск с валидным токеном не кладёт диск/IO.
3. **TTL-уборка раз в минуту** (было 5 мин).
4. **nginx синхронизирован git↔сервер**: `/preview/` + `/widget/` с `autoindex off` (листинг → 403, перебор uuid невозможен); `limit_req` на `/preview-host` (20r/m, burst 10).
5. **markdown внешние `<img>`**: `referrerPolicy=no-referrer` + `loading=lazy` (codex P3 — не утекает origin/referrer amoCRM).

## Проверки после фиксов
- сервер: без токена→401 (тело не копится), csv→xlsx с токеном ok, `/preview/` листинг→403, контейнер healthy;
- e2e venskons78: xlsx→Office viewer ok; тесты 29/29.

## Не делалось (осознанно)
- лимит суммарного размера каталога /preview (P2 субагент) — достаточно p-limit + TTL 1мин + nginx rate-limit для текущей модели угроз; вернуться при росте нагрузки;
- image.js lifecycle-гонка (codex P3) — modal уже защищён `this._loader!==loader` + dispose() abort'ит и revoke'ит; реальной утечки не выявлено.
