#!/usr/bin/env bash
# Синтетические замеры конвертера (спека 01_specs/04_geo_performance_spec.md, этап 0).
#
# Меряет per-stage тайминги curl'ом для матрицы ячеек:
#   health        GET  /health            — чистая сеть (DNS/TCP/TLS/RTT), без конвертации
#   conv-small    POST /convert           — small .doc (~77КБ), холодная конвертация LibreOffice
#   conv-medium   POST /convert           — medium .xlsx (~2.8МБ), аплоад + конвертация
#   prev-docx     POST /preview-host      — small .docx, публикация для Office viewer
#   prev-csv      POST /preview-host      — csv → xlsx конвертация + публикация
#
# ВАЖНО (ограничение curl, спека этап 0): time_starttransfer − time_pretransfer =
# аплоад + ВСЁ серверное время вместе; раздельно сеть/сервер считается только после
# этапа 1 по серверным логам: network_ms = total − server_ms − TLS-handshake.
#
# Auth: поддельный Origin кабинета (принятый риск, спека §8). X-Source-Token сюда
# НЕ вписывать и на сторонние VPS не выносить.
#
# Использование:  ./geo-probe.sh <point-label> [runs]   (например: ./geo-probe.sh local 10)
# Выход: CSV в stdout: point,cell,run,http_code,dns_s,tcp_s,tls_s,pretransfer_s,starttransfer_s,total_s,size_up
# Между прогонами sleep 2с — чтобы не въезжать в rate-limit (30/мин на Origin).

set -u
HOST="${PROBE_HOST:-https://nexus-oko.naithon.one}"
ORIGIN="${PROBE_ORIGIN:-https://geoprobe.amocrm.ru}"
POINT="${1:-local}"
RUNS="${2:-10}"

# Фикстуры (пути от корня репо; переопределяются env'ом для запуска вне репо)
FIX_DOC="${FIX_DOC:-work_directory/tests/fixtures/user_files/КП Меню и Анимация (Уфа) 9171.doc}"
FIX_XLSX="${FIX_XLSX:-work_directory/tests/fixtures/user_files/region.xlsx}"
FIX_DOCX="${FIX_DOCX:-work_directory/tests/fixtures/upload/kp.docx}"
FIX_CSV="${FIX_CSV:-work_directory/tests/fixtures/user_files/get_creatives_daily_stat_2026-05-31_2026-06-02.csv}"

# reqid — X-Request-Id из ответа (появился в T24): джойн проб с серверными логами
# при подсчёте гейта CDN (network_ms = total − server_ms − TLS).
W='%{http_code},%{time_namelookup},%{time_connect},%{time_appconnect},%{time_pretransfer},%{time_starttransfer},%{time_total},%{size_upload},%header{x-request-id}'

probe_get () { # cell url
  curl -sS -o /dev/null -w "$W" -H "Origin: $ORIGIN" "$2"
}
probe_post () { # cell url file name
  curl -sS -o /dev/null -w "$W" -X POST \
    -H "Origin: $ORIGIN" -H "Content-Type: application/octet-stream" \
    -H "X-Filename: $(python3 - "$3" <<'PY' 2>/dev/null || basename "$3"
import sys, urllib.parse, os
print(urllib.parse.quote(os.path.basename(sys.argv[1])))
PY
)" \
    --data-binary @"$3" "$2"
}

echo "point,cell,run,http_code,dns_s,tcp_s,tls_s,pretransfer_s,starttransfer_s,total_s,size_up,reqid"
for i in $(seq 1 "$RUNS"); do
  echo "$POINT,health,$i,$(probe_get health "$HOST/health")"
  sleep 1
  echo "$POINT,conv-small,$i,$(probe_post conv "$HOST/convert" "$FIX_DOC")"
  sleep 2
  echo "$POINT,conv-medium,$i,$(probe_post conv "$HOST/convert" "$FIX_XLSX")"
  sleep 2
  echo "$POINT,prev-docx,$i,$(probe_post prev "$HOST/preview-host" "$FIX_DOCX")"
  sleep 2
  echo "$POINT,prev-csv,$i,$(probe_post prev "$HOST/preview-host" "$FIX_CSV")"
  sleep 2
done
