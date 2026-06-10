# Деплой-инфраструктура конвертера (сервер 72.56.1.123, jino.ru)

Состояние почвы под эпоху 2 (2026-06-10, prep AMO-13/15):

## Установлено и работает
- **Docker** 29.1.3 + **compose v2** (`/etc/docker/daemon.json` = `docker-daemon.json` — зеркала, Docker Hub режет анонимный pull). `docker run hello-world` — OK.
- **nginx** 1.24, vhost `nexus-oko.conf` (= `nginx-nexus-oko.conf`): 80 → 301 → 443, 443 ssl → proxy `127.0.0.1:8094`. `nginx -t` OK, локально отдаёт 502 (бэкенда-конвертера ещё нет — ожидаемо).
- **TLS-сертификат Let's Encrypt** — ✅ ВЫПУЩЕН для nexus-oko.naithon.one через **DNS-01** (TXT `_acme-challenge` в Cloudflare, зона naithon.one). Действует до 2026-09-08. `/etc/letsencrypt/live/nexus-oko.naithon.one/`.
- **ufw**: allow OpenSSH + Nginx Full, enabled.
- Вход: `ssh amo-devbox` (ключ `~/.ssh/amo_devbox`).

## ⚠️ ОТКРЫТЫЙ БЛОКЕР: jino режет входящий веб-трафик (80 и 443)
Снаружи TCP к 80/443 «открывается», но HTTP/TLS не проходит (таймаут с нескольких источников; 0 acme-hits в access.log при HTTP-01). ufw на сервере открыт — блок ВЫШЕ, на сетевом уровне хостера jino (firewall/anti-DDoS/scrubbing).
**Следствие:** браузер пользователя (виджет в amoCRM) пока НЕ достучится до `https://nexus-oko.naithon.one/convert` — это нужно к T16 (legacy e2e) и T19 (прод), НЕ раньше. Разработка конвертера (T13) идёт локально на сервере по `http://127.0.0.1:8094` — блок не мешает.
**Что нужно (действие на стороне хостинга):** в панели jino открыть/разрешить ВХОДЯЩИЕ 80 и 443 (сетевые правила / security group), либо тикет в саппорт «откройте входящий веб-трафик на VPS». После этого внешний доступ заработает без изменений на сервере.

## TLS autorenew
Сертификат выпущен в --manual режиме → автообновления НЕТ. Для autorenew перейти на DNS-01 с Cloudflare API:
`apt install python3-certbot-dns-cloudflare`, токен (Zone:DNS:Edit на naithon.one) в `/root/.secrets/cloudflare.ini` (chmod 600),
`certbot certonly --dns-cloudflare --dns-cloudflare-credentials /root/.secrets/cloudflare.ini -d nexus-oko.naithon.one` — тогда systemd-timer обновляет сам. Сделать к T15.
