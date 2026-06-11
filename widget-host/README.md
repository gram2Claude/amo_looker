# Хостинг виджета для букмарклет-теста (сервер 95.216.44.25 / nexus-oko.naithon.one)

Тестовый активатор Nexus Looker для технического аккаунта venskons78 (см. `work_directory/01_specs/03_bookmarklet_test_tool.md`).

## Что на сервере
- `/opt/nexus-widget/` — статика: `boot.js`, `script.js`, `style.css`, `vendor/{docx-preview,jszip,xlsx}`.
- nginx vhost nexus-oko.conf: `location /widget/ { alias /opt/nexus-widget/; }`.
- В `boot.js` НА СЕРВЕРЕ подставлен реальный CONVERTER_TOKEN (тут — `boot.js.template` с плейсхолдером; токен не в git).

## Обновить хостинг после пересборки виджета
```
npm run build                       # → dist/script.js
# собрать пакет: dist/script.js + style.css + vendor/* + boot.js (с токеном из /opt/nexus-converter/.env)
scp пакет на сервер → tar -C /opt/nexus-widget
```
Скрипт деплоя — в истории сессии (.gstack/widget-deploy не в git). boot.js.template — каноничный источник, токен подставить из env.

## Букмарклет (строка закладки, токена НЕ содержит)
```
javascript:(function(){var s=document.createElement('script');s.src='https://nexus-oko.naithon.one/widget/boot.js?'+Date.now();document.body.appendChild(s);})();void(0);
```
