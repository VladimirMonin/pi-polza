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
- Файл `.env` в корне с `POLZA_API_KEY=...` (в git не попадает, см. `.env.example`).

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
