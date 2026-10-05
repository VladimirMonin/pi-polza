# Учёт по native observer: офлайн-доказательство и границы

База: `af36ed0`, исходное дерево чистое. Срез: stream accounting + уже существующий stale
баланса. Владелец явно разрешил исключение из правила живого эксперимента для офлайн
воспроизведённого дефекта (council `polza-council-20261005/FINAL.md`). **Live cause: NOT TESTED**:
порядок usage/DONE/EOF в активном окне, runtime identity и причинность обновления Pi неизвестны.
Платных вызовов, сети, запуска CLI Pi, установки или изменений активного профиля не было.

## Synthetic proof → исправление

До правок production: `node --test tests/stream-native.test.ts tests/usage-cost.test.ts` —
3 теста, 1 PASS, 2 FAIL. Настоящий bundled transport завершил ответ с `stop`, но старый
`tapResponseForUsage` при DONE и запланированном EOF через 60 мс дал `[]` вместо `[0.25]`.
Отдельно `normalizeUsage({cost_rub: "bad"})` дал `0` вместо `null`. Это условный транспортный
дефект и дефект границы нормализации, не реконструкция реального инцидента.

Исправление сохраняет snapshot последнего raw usage **до** caller callback. Continuation
исходного `result()` регистрируется до возврата исходного stream. Только успешные
`stop`/`length`/`toolUse` разрешают последний cost; error/aborted/pending/rejected result —
unknown. Missing/malformed cost — unknown; настоящий ноль и числовая decimal-string сохранены.
Sink и ошибки собственного учёта изолированы. Никакого второго iterator/draining/response tap
в runtime; исторические tap/scanner и их тесты оставлены. Debug reasoning/custom fetch сохранены.
`onUsageRecord -> requestCompleted`, `agent_end`, TTL 45с и coalescing не менялись.

`state=stale` теперь виден как семантический warning-marker; сумма остаётся, успешный refresh
снимает marker. Aging-state, таймер или новые события жизненного цикла не добавлены.

## Проверка и происхождение SDK

Прочитаны полностью installed `docs/custom-provider.md`, `docs/themes.md`, pi-ai README,
а также observer/completion/lazy исходники. Node `v25.8.1`; installed coding-agent и pi-ai `1.0.2`.
Bundled chunks из `@earendil-works/pi-coding-agent/dist/bundle/chunks`, SHA-256:

- `openai-completions-GWHGMQ3T.js`: `33ca6e4992006b2b38133fe94222318cf83aec1165c336497aee4fe8f8d28ad1`
- `chunk-7JGR3GZN.js` (lazyApi): `f1591c11a9bc971465ba9d31253ed40b081a0d5c45a5a5d94139f0aaaec5ea16`
- `chunk-A3JYRWB6.js` (event stream): `39a18bfbaf6a8edd098844da7988e1ff4a5551520e47c4aacbfc95e7c669a843`

`tests/stream-native.test.ts` загружает production `stream.ts` и новый production helper.
Hook заменяет **только resolution виртуального compat import**: factory использует настоящие
bundled lazyApi и transport с той же factory expression, что у installed compat. Транспорт,
SDK SSE parser, observer await и result/event queue — реальные; HTTP body — synthetic fixture,
ключ — placeholder. Global network fetch запрещён. CLI, полный agent/UI lifecycle и live Polza
не запускались. Полная compat export table не загружалась. При отсутствии этой локальной сборки
native suite явно SKIP, а не фиктивный native PASS.

Оба stream entry points проверены: EOF без DONE, DONE+EOF вместе, producer EOF запланирован
через 60 мс, open producer после DONE. Native SDK отменяет reader после DONE; fixture учитывает
cancellation отдельно от producer EOF. Учёт уже готов до запланированного EOF, не требует
дочитывания. Также проверены last usage once; missing/malformed/zero; error/abort/incomplete
до/после usage; sync/async/throw/reject caller; throwing/rejecting sink; snapshot mutation;
result-only сохраняет event queue; result+iterator не дублируют sink; sink до внешнего terminal.
Связанный тест использует настоящий accumulator, сериализацию record и status.requestCompleted
до terminal; это не запуск extension factory или настоящего session manager/agent_end.

`tests/stream-accounting.test.ts` — отдельно обозначенная mock injection для identity исходного
stream/result, отсутствия второго consumer, forwarded options/fetch/response, callback promise,
pending/rejected result, uncloneable usage и reasoning debug. Mock не называется native proof.

- Финальный focused: `node --test tests/stream-native.test.ts tests/stream-accounting.test.ts tests/usage-cost.test.ts tests/status.test.ts`
  — **68 PASS, 0 FAIL, 0 SKIP** (включая 47 native integration tests).
- `npm test` — **203 PASS, 0 FAIL, 0 SKIP**.
- Промежуточный focused: 57 PASS / 7 FAIL из-за cleanup fixture после native reader cancellation;
  исправлена только fixture cancellation bookkeeping; production не менялся ради этих failures.
  Затем 64/64 PASS и финальный расширенный 68/68 PASS.
- `git diff --check` — PASS (только предупреждения LF/CRLF).
- Стандартный `npm run audit:secrets` **NOT RUN**: он читает .env и внешние runtime sessions,
  что запрещено для этого среза. Вместо него — ограниченная generic key-shaped проверка только
  изменённых source/tests/docs — **11 файлов, 0 совпадений, PASS**. Это не аудит живого ключа,
  истории или внешних workspace.
- `test:live`, install, version bump, staging/commit/tag/push/release — **NOT RUN**.

## Завершённый todo и безопасный следующий шаг

- [x] Проверить инструкции/council, seam и installed API.
- [x] Воспроизвести оба дефекта до production fix.
- [x] Native observer/result и stale marker, узкая граница cost_rub.
- [x] Focused/native и полный offline suite; Unreleased и эта заметка.

Дальше — независимый review точных исправленных bytes. Владелец уточнил: простота важнее
специальной подготовки; он сам проверит исправление в новой сессии. Parent выполняет обычное
plugin-only локальное обновление на безопасной границе позже. Candidate profiles, launchers,
дополнительные observers и installation harnesses не нужны и не созданы; synthetic bundle test —
узкое доказательство, не новый framework. Активная общая установка и Pi build этим срезом не
меняются. Rollback — прежний source `af36ed0` и новый запуск; денежные записи не стирать.
Ничего не установлено и не запущено.

## Подготовка исходного кандидата v0.2.1 — 2026-10-05

Предыдущие результаты выше — запись этапа реализации, а не текущий статус релиза.
Независимый reviewer принял исправление; владелец затем сообщил, что установленный
плагин работает в новой сессии. Это **пользовательская live-приёмка**, не новый
инструментальный эксперимент: сырые логи, ключи и финансовые данные не собирались.
Она не устанавливает причинность исходного инцидента и не превращает synthetic SSE
в live-доказательство порядка usage/DONE/EOF. Полный live-прогон background-подагентов
по-прежнему не выполнен.

Подготовлен только исходный кандидат **v0.2.1** для Pi Agent **1.0.2**.
Совместимость со всеми 1.x не заявляется. Runtime bytes принятого исправления сохранены;
обновлены версия пакета, журнал изменений и RU/EN README. Интеграция в Pi build,
установка и изменение профиля в этот этап не входят. Тег/публикация ещё не разрешены.

В native-тесте больше нет личного абсолютного пути. SDK ищется в локальном
`node_modules`, стандартных npm-каталогах, выведенных из `APPDATA`/`process.execPath`,
либо по **абсолютному** `PI_POLZA_TEST_SDK_ROOT` (корень установленного пакета
`@earendil-works/pi-coding-agent`, не профиль и не файл окружения).
Проверяются версия **1.0.2** и наличие ожидаемых bundled chunks. При отсутствии
подходящего SDK тесты явно SKIP с причиной; mock transport не используется вместо native.
Production entry/helper и настоящие bundled lazyApi/transport остаются под тестом.

Повторная проверка кандидата (Node `v25.8.1`, установленный SDK `1.0.2`):

- `npm test` — **203 PASS, 0 FAIL, 0 SKIP**.
- `node --test tests/stream-native.test.ts tests/stream-accounting.test.ts tests/usage-cost.test.ts tests/status.test.ts`
  — **68 PASS, 0 FAIL, 0 SKIP**, из них **47 native**.
- Код `scripts/audit-secrets.ts` и загрузчик dotenv прочитаны перед запуском:
  отчёт содержит категории, пути и счётчики, но не значения секретов;
  Git history использует `grep -l`, а временный файл шаблонов удаляется.
  Чтение исключённых env/runtime workspace внутренним scanner разрешено для этого этапа.
  `npm run audit:secrets` — **PASS**: дерево, история, smoke workspace и Polza sessions чисты.
  Секреты не выводились; scanner не изменён.
- `npm pack --dry-run --json` — **44 файла**, только runtime TypeScript, изображения,
  package metadata, README, CHANGELOG и LICENSE. Новый `stream-accounting.ts` включён;
  tests/scripts/notes/artifacts/env/runtime cache исключены. `openrouter-cache.ts` —
  runtime-модуль, а не файл кэша; он закономерно включён. Архив не создан.
- `git diff --check` — PASS; staging отсутствует.
- Принятые пять runtime-файлов совпадают с исходными SHA-256 этого этапа.
  Хеши extension, package metadata и пользовательских документов частной Git-установки,
  а также её Git status совпадают до/после подготовки; установленная копия не изменена.
- `test:live`, build integration, install/profile edits, stage/commit/tag/push,
  GitHub Release и `npm publish` — **NOT RUN**.

Todo подготовки:

- [x] Сохранить принятый runtime fix, сделать только PATCH bump и актуальные RU/EN docs.
- [x] Сделать native SDK discovery переносимым, не подменяя bundle coverage.
- [x] Повторить offline/native checks, разрешённый secret audit и package dry-run.
- [x] Проверить неизменность частной установки и отсутствие staging.

Следующий шаг — review точного source candidate и отдельное разрешение владельца
на коммит, интеграцию в build и публичные действия. В этом этапе они не выполнялись.

## Финальная проверка перед публикацией

Владелец явно подтвердил выпуск нового `v0.2.1` и последующую интеграцию в сборку;
опубликованные теги не передвигаются. Независимый release review — `OK with notes`.
Его замечание к обнаружению SDK исправлено: неподдержанный или неполный локальный
кандидат больше не скрывает подходящий глобальный SDK. Проверены оба случая —
**47/47 native PASS, 0 SKIP** каждый. Явный override по-прежнему имеет приоритет.
Повторно: **203/203 offline PASS, 0 SKIP**, secret audit PASS, package dry-run —
**44 файла**, запрещённых файлов нет. Это не дополнительный живой эксперимент;
пользовательская приёмка и ограничения live/background остаются указанными выше.
