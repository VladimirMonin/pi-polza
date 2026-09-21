# AGENTS.md

`pi-polza` — нативный динамический провайдер моделей Polza AI для Pi Agent (не просто
OpenAI-compatible endpoint): автозагрузка каталога, capabilities (context, vision, reasoning,
tools), pricing с раздельным учётом USD и нативных RUB.
Идея проекта: [docs/pi_polza_provider_architecture.md](docs/pi_polza_provider_architecture.md)

**Главный принцип: сначала доказательство фактического поведения → потом реализация.**
Ничего не выдумывать; неизвестное честно помечать как неизвестное.

## Жёсткие инварианты

Постоянные правила проекта. Нарушение = баг, даже если тесты зелёные.

### Честность данных

- Неизвестное значение — **`unknown`**, никогда не `0` и не догадка. Отсутствие значения не
  заполняется правдоподобным.
- Capabilities — **tri-state**: подтверждено / опровергнуто / неизвестно. Отсутствие подтверждения
  ≠ `false`.
- `reasoning_tokens === 0` **≠** reasoning выключен. `offVerified` — только при прямом
  доказательстве; подтверждение уровней — только при воспроизводимых доказательствах на нескольких
  запросах.
- Сырые транспортируемые значения не называть «mapped».
- Приоритет метаданных: **override → Polza → OpenRouter → unknown**. OpenRouter — только
  обогащение, сопоставление строго по точному id модели.
- Никогда не подменять `unknown` / `not verified` догадками.

### Деньги и учёт

- Фактическая стоимость — только **`usage.cost_rub`** от Polza (авторитетный источник).
- **Никогда** не писать RUB в долларовое поле `cost` в Pi — там намеренный `0`.
- Не оценивать расходы сессии по ценам за токены; цены каталога — только ориентир.
- Никакой конвертации валют (FX).

### Безопасность

- `POLZA_API_KEY` **никогда** не попадает в stdout/stderr, трейсы, журналы сессий или ошибки.
- Заголовок `Authorization` удаляется перед любым HTTP-логированием.
- `.env` в `.gitignore`; секреты не коммитить; перед релизом — `npm run audit:secrets`.
- Установленный пакет **не читает** `.env` из исходного checkout (только `<cwd>/.env` или
  `PI_POLZA_ENV_FILE`).

### Нативные механизмы Pi

- Не изобретать хранение секретов — использовать нативный auth / credential store Pi.
- Только семантические цвета темы (`ctx.ui.theme.fg(...)`), никаких hardcoded ANSI/RGB.
- Не добавлять свои обёртки транспорта там, где есть нативные механизмы Pi.

### Процесс

- Работать по todo-листу и **отмечать пункты сразу** по завершении.
- Мелкие логические коммиты; не выходить за рамки задачи; без scope creep.
- Не переписывать историю: никаких `amend`/`rebase`/`push --force` на запушенном.
- **Стоп и явное разрешение** перед `git push`, тегом и релизом. Без `npm publish`.
- Перед реализацией — живой эксперимент и заметка с доказательствами в `notes/`.

> Область работ задаётся текущим ТЗ. Запреты отдельных итераций (медиа-генерация, routing,
> сабагенты и т.п.) — это ограничения конкретной задачи, а **не** постоянные правила проекта:
> их нельзя «закрепить» в инвариантах навсегда.

## Инструкции

- [instructions/commit-and-release-guide.md](instructions/commit-and-release-guide.md) — коммиты,
  теги, релизы, журнал изменений, безопасность публикации
- [instructions/manual-testing.md](instructions/manual-testing.md) — подготовка и проведение
  приёмочного теста установки

## Документация

- [README.md](README.md) — пользовательский README, русский (основной) ·
  [README.en.md](README.en.md) — English
- [CHANGELOG.md](CHANGELOG.md) — журнал изменений (Keep a Changelog)
- [docs/pi_polza_provider_architecture.md](docs/pi_polza_provider_architecture.md) — идея и архитектура
- [LICENSE](LICENSE) — MIT

## Инженерные заметки (доказательства)

- API Pi и находки: [notes/pi-api-findings.md](notes/pi-api-findings.md)
- Метаданные: [notes/metadata-resolution.md](notes/metadata-resolution.md) ·
  [notes/metadata-conflicts.md](notes/metadata-conflicts.md) ·
  [notes/orphan-models.md](notes/orphan-models.md)
- Учёт расходов: [notes/native-rub-accounting.md](notes/native-rub-accounting.md) ·
  [notes/streaming-accounting.md](notes/streaming-accounting.md) ·
  [notes/usage-experiment.md](notes/usage-experiment.md)
- UI: [notes/status-footer.md](notes/status-footer.md)
- Reasoning: [notes/reasoning-levels.md](notes/reasoning-levels.md)
- Кэш OpenRouter: [notes/openrouter-cache.md](notes/openrouter-cache.md)
- Отчёты о приёмке: [notes/acceptance-report.md](notes/acceptance-report.md) ·
  [notes/acceptance-report-iteration2.md](notes/acceptance-report-iteration2.md) ·
  [notes/acceptance-report-iteration3.md](notes/acceptance-report-iteration3.md)
