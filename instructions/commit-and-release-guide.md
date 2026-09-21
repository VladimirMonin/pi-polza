# Конвенции коммитов, тегов и релизов

Внутреннее соглашение проекта. Выведено из коммитов, реально сделанных в этом репозитории —
эталоном служит история. Правила одинаковы для людей и для агентов.

## 1. Сообщения коммитов

```
<тип>(<область>): <повелительное описание>

<необязательное тело: пункты, объясняющие ПОЧЕМУ, строки ~80 символов>
```

- **Повелительное наклонение**, настоящее время: `add`, `fix`, `document` — не `added` / `fixes`.
- Тема **≤ 72 символов**, без точки в конце, без `wip`.
- Пустая строка, затем тело, если причина неочевидна из темы.
- Писать **почему**, а не пересказ диффа. Числа и измерения приветствуются.
- Один логический смысл на коммит. Не смешивать рефакторинг с изменением поведения.

### Типы, реально используемые в проекте

| Тип | Для чего |
| --- | --- |
| `feat` | новое видимое пользователю поведение |
| `fix` | исправление ошибки |
| `docs` | README, заметки, инструкции |
| `test` | только тесты |
| `style` | оформление/формат, без изменения поведения |
| `refactor` | внутренняя перестройка, поведение то же |
| `perf` | производительность |
| `chore` | инструменты, метаданные пакета, рутина |
| `security` | секреты, аутентификация, аудит |

### Области (scope)

Строчные имена областей. Сначала переиспользуйте существующие: `auth`, `catalog`, `metadata`,
`mapper`, `usage`, `accounting`, `pricing`, `provider`, `stream`, `status`, `commands`, `ui`,
`presentation`, `env`, `readme`, `package`, `live`, `audit`, `security`.

### Примеры из этого репозитория

```
feat(auth): register Polza via createProvider with native Pi API-key login
fix(env): never read the source checkout .env from an installed package
style(ui): theme the Polza footer with semantic colors
docs(readme): user-facing README for the public release
security(audit): key-shaped regex instead of literals; ignore placeholders and the script itself
```

Пример тела (почему + доказательства):

```
fix(env): never read the source checkout .env from an installed package

- resolveDotEnvPath() is pure and testable; no fallback to <repo>/.env
- when Pi runs from the checkout, cwd IS the checkout, so dev still works
- from any other project only <cwd>/.env or PI_POLZA_ENV_FILE is used
- adds tests/env.test.ts (5 cases) → 101 unit tests
```

### Чего делать нельзя

- **Не переписывать историю**: никакого `git commit --amend` для запушенных коммитов, никакого
  `rebase`, никакого `push --force`. Исправления — новым коммитом вперёд.
- Не коммитить `.env`, ключи, учётные данные, сырые артефакты и рабочие кэши.
- Не коммитить, не запустив `npm test`, если менялся код в `.pi/extensions/pi-polza/`.

## 2. Версионирование

SemVer `MAJOR.MINOR.PATCH`. Политика до 1.0, принятая здесь:

- `PATCH` — исправление, документация, внутреннее изменение;
- `MINOR` — видимая пользователю возможность (ломающие изменения допустимы в MINOR, пока `0.x`);
- `MAJOR` — зарезервировано под `1.0.0`.

`version` живёт **только в `package.json`** (единственный источник истины) и совпадает с тегом.

## 3. Теги

- **Аннотированные** теги: `git tag -a v0.1.0 -m "..."`.
- Формат `vMAJOR.MINOR.PATCH`.
- Сообщение тега — краткая сводка релиза, оно же ложится в основу GitHub Release.
- **Опубликованный тег никогда не двигать и не удалять.** Исправление релиза — новый патч.
- Пушить теги явно: `git push origin vX.Y.Z`.
- Проверка: `git describe --tags --exact-match HEAD` печатает тег, когда `HEAD` — ровно релиз.

```bash
git tag -a v0.1.0 -m "pi-polza v0.1.0

Native Polza AI provider for Pi Agent.
- native /login authentication
- dynamic catalog (285 selectable models)
- actual RUB accounting from usage.cost_rub"
git push origin v0.1.0
```

## 4. Процесс релиза

Предполётная проверка (всё должно быть истинно):

```
[ ] npm test                     зелёный
[ ] npm run test:live            зелёный (тратит небольшую сумму)
[ ] npm run audit:secrets        PASS (дерево, история, workspace)
[ ] npm pack --dry-run           только нужные файлы; без tests/scripts/notes/.env/кэшей
[ ] README + скриншоты           актуальны
[ ] version в package.json       поднят и совпадает с планируемым тегом
[ ] CHANGELOG.md                 обновлён (см. §5)
[ ] git status                   чисто
```

Затем:

```bash
# 1. коммит с поднятием версии (chore(release) или подходящий тип)
# 2. тег
git tag -a vX.Y.Z -m "<сводка релиза>"
# 3. ветка и тег
git push origin main
git push origin vX.Y.Z
# 4. GitHub Release с приложенным артефактом
npm pack
gh release create vX.Y.Z --verify-tag --title "pi-polza vX.Y.Z" --notes-file notes.txt "pi-polza-X.Y.Z.tgz#pi-polza-X.Y.Z.tgz"
rm -f pi-polza-X.Y.Z.tgz
```

Пост-проверка релиза:

```bash
gh release view vX.Y.Z --json tagName,isDraft,isPrerelease,assets
curl -s -o /dev/null -w "%{http_code}\n" https://github.com/VladimirMonin/pi-polza/releases/download/vX.Y.Z/pi-polza-X.Y.Z.tgz
```

Структура заметок к релизу: одна строка-питч → скриншот → ключевые возможности → команда установки
→ результаты проверок → известные ограничения → лицензия.

## 5. Журнал изменений (`CHANGELOG.md`)

- Формат — [Keep a Changelog 1.1.0](https://keepachangelog.com/ru/1.1.0/), версии — SemVer.
- **Язык — русский** (публичная аудитория проекта русскоязычная).
- Разделы, в этом порядке; пустые не включать:

  `Добавлено` · `Изменено` · `Устарело` · `Удалено` · `Исправлено` · `Безопасность`

- Обновлять **в том же коммите**, что и само изменение, в разделе `[Unreleased]` — не откладывать
  «на потом».
- Формулировать **с точки зрения пользователя**: что он теперь может или чего больше не сломается,
  а не пересказ диффа.
- Внутренние изменения без пользовательского эффекта в журнал не попадают.
- **При релизе**:
  1. переименовать `[Unreleased]` → `[X.Y.Z] - ГГГГ-ММ-ДД`;
  2. добавить новый пустой `[Unreleased]`;
  3. обновить ссылки сравнения внизу файла.
- **Прошлые записи не переписывать.**
- Заготовка записи для новой версии:

```markdown
## [Unreleased]

### Добавлено

- ...

### Исправлено

- ...
```

Ссылки внизу файла:

```markdown
[Unreleased]: https://github.com/VladimirMonin/pi-polza/compare/vX.Y.Z...HEAD
[X.Y.Z]: https://github.com/VladimirMonin/pi-polza/releases/tag/vX.Y.Z
```

## 6. Безопасность публикации

- **Остановиться и получить явное разрешение** перед первым `git push`, тегом, GitHub Release или
  любой публикацией.
- **Никакого `npm publish`.** Распространение — `pi install` из GitHub.
- Не создавать GitHub-репозиторий до подтверждения владельца и имени.
- Перед любым пушем убедиться, что секреты не отслеживаются:
  `git ls-files | grep -iE '\.env$|\.tgz$|credential'`.

## 7. Шпаргалка

```bash
git log --oneline -10                   # свежие примеры стиля
git describe --tags --exact-match HEAD  # убедиться, что HEAD — это релиз
git ls-remote --tags origin             # убедиться, что тег есть на remote
npm test && npm run audit:secrets       # перед каждым релизом
```
