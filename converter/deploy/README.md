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

## Дальше (эпоха 2)
- T13: собрать `amo-preview-converter` (Dockerfile + сервис /convert + /health), `docker compose up` → слушает 127.0.0.1:8094, nginx уже проксирует.
- Конкурентность LibreOffice: p-limit(2) (2 CPU), mem_limit контейнера ~2 GB (есть 3.8 GB).
- TLS и внешний доступ уже готовы — отдельных действий по сертификату/портам не требуется.
