#!/usr/bin/env bash
# Смоук конвертера. Использование: TOKEN=xxx ./test.sh [base_url]
# base_url по умолчанию http://127.0.0.1:8094 (локально на сервере).
set -u
BASE="${1:-http://127.0.0.1:8094}"
TOKEN="${TOKEN:-}"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
pass=0; fail=0
chk() { if [ "$1" = "$2" ]; then echo "  OK: $3 ($1)"; pass=$((pass+1)); else echo "  FAIL: $3 (got $1, want $2)"; fail=$((fail+1)); fi; }

echo "== /health =="
chk "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/health")" "200" "health 200"

echo "== auth: без токена → 401 =="
printf 'test' > "$TMP/x.doc"
chk "$(curl -s -o /dev/null -w '%{http_code}' --data-binary @"$TMP/x.doc" -H 'X-Filename: x.doc' "$BASE/convert")" "401" "no token 401"

echo "== OPTIONS preflight (без токена) → 204 =="
chk "$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS -H 'Origin: https://venskons78.amocrm.ru' -H 'Access-Control-Request-Method: POST' "$BASE/convert")" "204" "preflight 204"

echo "== конвертация реального .doc (нужен TOKEN и образец) =="
if [ -n "$TOKEN" ] && [ -f "$TMP_DOC" ] 2>/dev/null; then
  code=$(curl -s -o "$TMP/out.pdf" -w '%{http_code}' --data-binary @"$TMP_DOC" \
    -H 'Content-Type: application/octet-stream' -H "X-Filename: sample.doc" -H "X-Source-Token: $TOKEN" "$BASE/convert")
  chk "$code" "200" "convert .doc 200"
  head -c4 "$TMP/out.pdf" | grep -q '%PDF' && { echo "  OK: вывод — PDF"; pass=$((pass+1)); } || { echo "  FAIL: вывод не PDF"; fail=$((fail+1)); }
else
  echo "  SKIP: задай TOKEN и TMP_DOC=путь_к_.doc для полного теста"
fi

echo "== оверсайз (51МБ) → 413 =="
if [ -n "$TOKEN" ]; then
  head -c 53477376 /dev/zero > "$TMP/big.doc"
  chk "$(curl -s -o /dev/null -w '%{http_code}' --data-binary @"$TMP/big.doc" -H 'Content-Type: application/octet-stream' -H 'X-Filename: big.doc' -H "X-Source-Token: $TOKEN" "$BASE/convert")" "413" "oversize 413"
fi

echo "---"
echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
