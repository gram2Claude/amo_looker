# Ревью E1S4 (vendorLoader / docx / xlsx) — субагент + codex

**Дата:** 2026-06-11. Область: офисные форматы — `src/vendorLoader.js` (AMD-define трюк), docx/xlsx рендереры, XSS-фикс, тесты. Ревьюеры: независимый субагент Claude + OpenAI Codex.

## Субагент — применённые находки

| Находка | Severity | Решение |
|---|---|---|
| Глобальное окно `window.define=undefined` при параллельных docx+xlsx складывается → чужой `define()` RequireJS amoCRM теряется | важное | ✅ загрузки **сериализованы** (общая очередь `_chain`) — окна не перекрываются |
| Зависший `onload` оставит define занулённым **навсегда** → RequireJS amo сломан на вкладке | важное | ✅ **таймаут 20с** на скрипт → гарантированный restore |
| docx guard слабее xlsx (`window.docx` truthy vs `.read`) | мелочь | ✅ `window.docx && window.docx.renderAsync` |
| Большой лист из 10МБ-архива → фриз вкладки синхронным DOM | мелочь | ✅ кап `MAX_ROWS=2000` + пометка «показаны первые N» |
| Осиротевший `<script>` при ошибке | мелочь | ✅ `s.remove()` при error/timeout |
| Тесты не покрывают overlap/timeout | мелочь | ✅ +2 кейса |

Проверено живьём после правок: docx рендерится, `window.define` восстановлен (`function`).

## Codex — применённая находка (новая, субагент пропустил)

| Находка | Severity | Решение |
|---|---|---|
| `vendorLoader.js`: после таймаута/ошибки **запоздавший `onload`** скрипта всё ещё звал `next()` → грузил следующий vendor уже при видимом define → RequireJS перехватил бы UMD | **P1** | ✅ guard `if (settled) return` в onload/onerror/next + зануление `s.onload=s.onerror=null` при таймауте |
| Тест таймаута не ловил этот race | P2 | ✅ кейс «запоздавший onload после таймаута не грузит следующий скрипт» (проверяет `appended===['/hang.js']`, handlers занулены) |

`_chain.then(run,run)` — codex подтвердил: очередь не отравляется, каждый вызов получает свой результат. `_hideDepth` при сериализации корректен.

## Тесты
26 unit зелёные (vitest+jsdom): fileUtils, loader, vendorLoader (зануление/порядок/restore/overlap/timeout/late-onload), inject.

## Итог
Субагент: 2 важных + 4 мелочи — применены. Codex: 1 P1 (race позднего onload) + 1 P2 — применены. Все правки в тестах и проверены (docx живьём). Самое тонкое место (глобальный define в RequireJS-окружении) теперь защищено сериализацией + таймаутом + guard'ом от поздних коллбэков.
