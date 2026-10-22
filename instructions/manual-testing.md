# Проверка pi-polza: установка, дефект и интерфейс

Выбирайте проверку по изменению, а не полный TUI-обход после любой правки. [Инварианты](project-rules.md), [граница выпуска](commit-and-release-guide.md).

## 1. Источник и область проверки

Из checkout перед изменением:

```sh
git remote -v
git status --short
git fetch origin
git log -1 --format='%H %s' HEAD
```

Remote — `https://github.com/VladimirMonin/pi-polza` (допустим `.git`). Запишите SHA/версию пакета, Pi/Node, ОС и способ подключения. Сохраните чужие изменения, не чистите дерево ради теста.

| Изменение | Достаточная начальная проверка |
|---|---|
| Ссылка/поясняющий Markdown | Смысл, links, RU/EN; без Pi и платных вызовов |
| Известный локальный дефект | Воспроизведение → минимальная правка → existing affected regression → настоящий consumer |
| Auth/catalog/lifecycle | Настоящий Pi/extension path на synthetic profile; HTTP можно подменить |
| Футер, login/model picker, panel | Только affected TUI-сценарий и существенный отказ на целевой ОС |
| Выпуск/общий транспортный контракт | Применимый полный offline suite и согласованные runtime/live cases |

Прежние применимые результаты переиспользуются с исходной версией и scope. Отдельный live-эксперимент нужен при существенной неопределённости внешнего контракта, не перед каждым fix. Установка принятого пакета не требует заново разрабатывать выпуск; наличие ключа не разрешает расходы.

## 2. Git-установка и локальный checkout — разные источники

Опубликованная ревизия:

```sh
pi install "https://github.com/VladimirMonin/pi-polza@<PUBLISHED_REF>"
pi list
```

Подставьте доступный tag/commit. Git-install получает отдельный managed checkout; правки соседнего source repository его не обновляют. Приёмочный cwd — `<SMOKE_CWD>` без project extension из исходников. Сборка устанавливается по своему manifest, не local override.

Для разработки:

```sh
pi install "<REPO_ROOT>"
pi list
```

Local entry ссылается на source tree; в settings может быть относительный путь. Это не копия опубликованного артефакта и не proof Git-доставки. При переносе checkout исправьте подключение штатным remove/install. Не подключайте local и Git копии одновременно.

`PI_CODING_AGENT_DIR` задаётся процессу. Synthetic тесты получают свои auth/settings/cache/session roots; рабочий профиль владельца не fixture. Не копируйте личные credentials/БД и не выводите целиком settings/auth. `pi list` не доказывает загрузку или каталог.

## 3. Auth и cold start

Обычный вход: `/login` → **Polza AI** → **Sign in with an API key**. Ключ вводит человек в Pi. `.env` не prerequisite сохранённого credential. Advanced fallback — `POLZA_API_KEY`, cwd `.env` или явный `PI_POLZA_ENV_FILE`; установленный пакет не ищет `.env` в source checkout. Сохранённый credential имеет приоритет.

При изменении auth/catalog проверьте:

1. Новый synthetic profile, нет catalog cache, Polza env и `.env`-обхода.
2. Credential сохранён через штатный API Pi; работает настоящий extension lifecycle.
3. Основной `polza` catalog доступен **до первого рабочего запроса**.
4. Повторный запуск, missing/rejected key, network failure и отсутствующая модель различимы.
5. Saved credential выигрывает у конфликтующего env; значение ключа нигде не выводится.

HTTP можно подменить synthetic ответами, сохранив настоящий owner Pi. Это runtime с подменённым сервисом, **не live Polza PASS**. Пустой каталог не готовность, даже если ответил служебный `polza-memory`. `/polza-refresh` полезен для диагностики, но не закрывает провал cold start.

## 4. Короткая функциональная приёмка

Новая сессия, доступная модель и известный scope расходов:

```sh
pi --list-models
pi --provider polza --model "<AVAILABLE_MODEL_ID>"
```

- `/model`, `/polza-model-info`: выбран `polza/<model-id>`. Автоматическая проверка сопоставляет ожидание с **SDK/RPC state и структурированным результатом**, не самоописанием модели. Mismatch, timeout, ошибка/обрыв — не PASS.
- `/polza-refresh`: каталог обновляется. Число моделей — наблюдение запуска, не постоянный критерий.
- Один короткий разрешённый ответ; streaming/tools проверяются, если затронут их контракт.
- `/polza-cost`: RUB только из `usage.cost_rub`, unknown не ноль, RUB не пишутся в USD. При изменении persistence — resume/reopen без удвоения.
- `/polza-balance`: кошелёк и stale flag, не разница баланса как стоимость сессии.
- Для изменённого UI — affected footer/panel/login и нужные состояния/размер окна. Визуальное качество подтверждается реальным visual review; баннер не заменяет результат.

Кеш — `<SMOKE_CWD>/.pi/pi-polza-cache/openrouter.json`. Если cwd=source root при разработке, кеш внутри checkout сам по себе не регрессия. `/polza-model-info` на другом provider корректно сообщает, что это не Polza model.

## 5. Offline и состав артефакта

Начните с существующего affected test path. На границе выпуска:

```sh
npm test
npm pack --dry-run --ignore-scripts
npm run audit:secrets
```

Смотрите фактический exit и итоги, не старые totals/размеры. Dry-run может писать npm cache/log: при ограниченном scope заранее задайте private tooling cache. Состав сверяйте с `files`/`pi.extensions` в `package.json`: runtime source, документация/images, license; без `.env`, credentials, raw artifacts, caches, tests и случайного `.tgz`.

В текущем `package.json` **`private: false`**. Это не разрешение на `npm publish`: распространение проекта — GitHub, публикация выполняется в прямом scope владельца через назначенного index owner.

## 6. Отказ, восстановление и итог

Сохраните version/command/ОС, этап и техническую причину без key, Authorization, private prompt/response или memory/session dump. Сначала исправьте причину, затем повторите case. При временном сетевом сбое допустим один осмысленный повтор, не бесконечный перебор моделей/флагов.

Удаляется только своё подключение через `pi remove <тот же source>` с readback `pi list`. Credentials, sessions и потребительский cache — отдельно при явной необходимости; весь профиль не удаляется. Рабочий env-обход сохраняется до доказанной замены штатным auth.

Итог: source/ref, версии/ОС, command + raw exit + наблюдение, static/offline/runtime/live/visual scope, reuse и конкретный NOT RUN/блокер. Не запускайте полный TUI или все paid probes ради отчёта. [Диагностика и хранение](project-rules.md#7-диагностика-и-хранение).
