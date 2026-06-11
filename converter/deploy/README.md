# Деплой-инфраструктура конвертера (сервер 95.216.44.25, Hetzner)

Сервер: **95.216.44.25**, Hetzner / Proxmox (VM 105), Ubuntu 24.04.4 LTS, 2 CPU / 3.8 GiB RAM / 38 GB. Свой публичный IP (не за NAT), изолирован от внутренней сети. Вход: `ssh amo-devbox` (ключ `~/.ssh/amo_devbox`).
Домен **nexus-oko.naithon.one** → A-запись на этот IP (DNS-only). Входящие 80/443 проходят снаружи (в отличие от прежнего сервера jino 72.56.1.123 — там провайдер резал веб-трафик; сервер заменён 10.06).

Состояние почвы под эпоху 2 (готово 2026-06-10):

## Установлено и проверено
- **Docker** 29.1.3 + **compose v2** 2.40.3 (`/etc/docker/daemon.json` = `docker-daemon.json` — зеркала, Docker Hub режет анонимный pull). `docker run hello-world` — OK.
- **nginx** 1.24, vhost `nexus-oko.conf` (= `nginx-nexus-oko.conf`): 80 → 301 → 443 ssl → proxy `127.0.0.1:8094`. Локально и снаружи отдаёт 502 (бэкенда-конвертера ещё нет — ожидаемо).
- **TLS Let's Encrypt** — ✅ выпущен через **HTTP-01** (`certbot --nginx`), до 2026-09-08, **autorenew включён** (systemd certbot.timer; порты доступны — обновляется без участия, токен Cloudflare не нужен).
- **ufw**: allow OpenSSH + Nginx Full, enabled.

## Проверка снаружи (с рабочей машины)
- `https://nexus-oko.naithon.one/` → TLS валиден (CN=nexus-oko.naithon.one), HTTP 502 (ждёт конвертер).
- `http://` → 301 на https.

## Конвертер развёрнут (AMO-13, 2026-06-11) ✅
- Код в репо: `converter/` (server.js, Dockerfile, docker-compose.yml, test.sh). На сервере: `/opt/nexus-converter/`.
- Контейнер `nexus-converter` (image `nexus-converter:latest`): Up, **healthy**, publish `127.0.0.1:8094`.
- Токен в `/opt/nexus-converter/.env` (`CONVERTER_TOKEN`, openssl rand -hex 24) — **НЕ в git** (gitignore + dockerignore).
- Лимиты: mem 2g, cpus 2, pids 256, tmpfs /tmp 1g; конкурентность p-limit(2); таймаут 30с; макс 50МБ.
- e2e-смоук пройден: реальный .doc(кириллица)→PDF 200 (%PDF-1.6); 51МБ→413; no-token→401; OPTIONS→204; чужой Origin без ACAO; 3 параллельных→очередь держит; через nginx HTTPS /health→200.
- Управление: `cd /opt/nexus-converter && docker compose --env-file .env up -d|down|logs`. Обновление кода: scp + `docker compose build && up -d`.

## Осталось для эпохи 2 (не AMO-13)
- T16: связать виджет с конвертером — передать `converter_url`/`converter_token` в legacy.js (env при сборке или advanced_settings), e2e .doc/.xls из ленты → PDF в модалке.

## Office Online preview (xlsx/csv → Excel-вид) — добавлено 11.06
- Endpoint `POST /preview-host` (токен, лимит 15МБ): принимает файл, csv конвертит в xlsx,
  кладёт во временную папку, возвращает публичный URL. Виджет отдаёт этот URL в
  Microsoft Office Online viewer (`view.officeapps.live.com/op/embed.aspx`).
- ⚠️ **ПРИВАТНОСТЬ:** при предпросмотре xlsx/csv файл уходит на серверы Microsoft (MS качает
  его по публичному URL с нашего сервера). Осознанное решение проекта.
- Том: `/opt/nexus-preview:/preview`. **ВАЖНО:** папка должна принадлежать uid 10001
  (`chown -R 10001:10001 /opt/nexus-preview`) — контейнер пишет под non-root conv(10001),
  иначе EACCES. nginx отдаёт публично через `location /preview/`.
- TTL: файлы старше 15 мин удаляются (setInterval в server.js). Имена — uuid (непредсказуемы).
