# pi-polza

Экспериментальный project-local custom provider для [Pi Agent](https://pi.dev), интегрирующий
[Polza AI](https://polza.ai) как динамический источник моделей.

## Статус

Первая итерация (proof of transport / catalog / capabilities / money). Осознанно **не** реализуются
image/video/STT/TTS/embeddings, routing, subagents, dashboard, публикация в npm, RUB→USD FX.

Принцип: **сначала доказательство фактического поведения API → потом реализация.**

## Что уже есть

- `docs/pi_polza_provider_architecture.md` — исходная архитектурная идея.
- `notes/` — инженерные заметки и результаты живых экспериментов.
- `scripts/` — независимые диагностические probe-скрипты (ходят в Polza напрямую).
- `src/` — переиспользуемые модули (env, catalog, mapper, usage, balance).
- `.pi/extensions/pi-polza/` — сам Pi extension.

## Требования

- Node.js >= 22.6 (запуск TypeScript напрямую через нативный type-stripping).
- Файл `.env` с `POLZA_API_KEY=...` (в git не попадает, см. `.env.example`).
  Файл ищется в порядке: `PI_POLZA_ENV_FILE` → `.env` в текущей рабочей директории
  (проект, из которого запущен Pi) → `.env` в исходном репозитории (только для разработки).
  Системная переменная `POLZA_API_KEY` работает без `.env`.

## Установка как Pi-пакета

Пакет объявлен в `package.json` через ключ `pi.extensions` и устанавливается
локально, без публикации в npm. Pi **не копирует** файлы — путь из настроек
указывает на этот репозиторий, поэтому после нового коммита достаточно
переустановить (или ничего не делать: код читается из рабочей копии).

```bash
# Установить из исходников (глобально, в ~/.pi/agent/settings.json)
pi install /absolute/path/to/pi-polza-connection-plugin

# То же, но только для одного проекта (.pi/settings.json)
pi install -l /absolute/path/to/pi-polza-connection-plugin

# Проверить, что пакет в списке
pi list

# Удалить
pi remove /absolute/path/to/pi-polza-connection-plugin
```

Проверить готовность артефакта до установки:

```bash
npm pack --dry-run     # что попадёт в tarball (без .env, artifacts, tests, scripts)
```

Куда положить ключ после установки — в проект, откуда вы запускаете Pi:

```
consumer-project/
├── .env              # POLZA_API_KEY=...
└── ...               # pi запускается отсюда же
```

Кэш метаданных OpenRouter создаётся в `<проект>/.pi/pi-polza-cache/` и
переживает перезапуск; при недоступности OpenRouter используется он.

## Запуск диагностики

```bash
npm run probe:catalog   # полный обход каталога + статистика
npm run probe:balance   # GET /api/v2/balance
npm run probe:chat      # один дешёвый non-streaming запрос + usage
npm run probe:stream    # streaming usage
npm run probe:cache     # дешёвый cache experiment
npm test                # unit-тесты mapper/usage
```

## Безопасность

`POLZA_API_KEY` никогда не логируется, не попадает в fixtures и ошибки; заголовок `Authorization`
вырезается перед любым HTTP-логированием. `.env` в `.gitignore`.
