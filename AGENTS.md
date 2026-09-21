# AGENTS.md

`pi-polza` — нативный динамический провайдер моделей Polza AI для Pi Agent (не просто
OpenAI-compatible endpoint): автозагрузка каталога моделей, определение capabilities
(context, vision, reasoning, tools), pricing с раздельным учётом USD и нативных RUB, основа для
будущего model routing и медиа-инструментов.

Главный принцип работы: **сначала доказательство фактического поведения → потом реализация.**

## Структура проекта

```
.pi/extensions/pi-polza/   расширение: провайдер, auth, каталог, mapper, учёт расходов,
                           метаданные, команды, футер, панели вывода
scripts/                   отдельные диагностические probe-скрипты
tests/                     офлайн-юнит-тесты (npm test)
tests-live/                live-тесты с бюджетом запросов (npm run test:live)
notes/                     инженерные заметки и доказательства живых экспериментов
docs/                      архитектурный документ и скриншоты
instructions/              правила для людей и агентов
```

## Инструкции

- [instructions/project-rules.md](instructions/project-rules.md) — постоянные правила и инварианты
  проекта (обязательны к соблюдению)
- [instructions/commit-and-release-guide.md](instructions/commit-and-release-guide.md) — коммиты,
  теги, релизы, журнал изменений, безопасность публикации
- [instructions/manual-testing.md](instructions/manual-testing.md) — подготовка и проведение
  приёмочного теста установки

## Документация

Пользовательская документация ведётся **на русском**: README (основной) с английской версией
`README.en.md`, журнал изменений `CHANGELOG.md` и архитектурный документ в `docs/`.
