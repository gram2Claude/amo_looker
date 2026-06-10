# Деплой-инфраструктура конвертера (сервер 72.56.1.123, jino.ru)

Состояние почвы под эпоху 2 (подготовлено 2026-06-10, AMO-13/15):

## Установлено на сервере
- **Docker** 29.1.3 + **compose v2** 2.40.3 (`/etc/docker/daemon.json` = `docker-daemon.json` — зеркала, т.к. Docker Hub режет анонимный pull). `docker run hello-world` — OK.
- **nginx** 1.24.0, vhost `nexus-oko.conf` (= `nginx-nexus-oko.conf`), проксирует на `127.0.0.1:8094` (там будет контейнер конвертера). `nginx -t` — OK.
- **certbot** 2.9.0 + plugin nginx.
- **ufw**: allow OpenSSH + Nginx Full, enabled.
- Вход: `ssh amo-devbox` (ключ `~/.ssh/amo_devbox`).

## TLS — НЕ выпущен (блокер уровня хостера)
`certbot --nginx -d nexus-oko.naithon.one` упал: ACME HTTP-01 не достучался до :80 снаружи
(0 acme-запросов в nginx access.log; внешний TCP к 80 «открывается», но HTTP не доходит — скрабинг/блок входящего у jino).
Развязка (нужно одно из):
1. Открыть/пробросить входящие 80 и 443 в панели jino (затем `certbot --nginx -d nexus-oko.naithon.one --redirect`).
2. DNS-01 challenge: `certbot certonly --manual --preferred-challenges dns -d nexus-oko.naithon.one`
   → добавить TXT `_acme-challenge.nexus-oko.naithon.one` в зону naithon.one (или API-плагин зоны).
Конвертеру (T13) сертификат не нужен для локальной разработки на сервере; нужен к моменту,
когда виджет на проде будет ходить на https://nexus-oko.naithon.one (T15/T16).
