# Interwar Command

Браузерный каркас пошагового варгейма. На тестовой карте 10×8 щелчок выделяет гекс и показывает его axial-координаты и расстояние до начала сетки. Перетаскивание двигает карту, колесо меняет масштаб вокруг указателя. Цвета и условные знаки служат для проверки отображения.

## Установка

Выполняйте команды из корня локальной рабочей копии. Для первой установки нужен доступ к реестрам Cargo и npm и источникам бинарных инструментов. Для Rust нужен системный линкер. В Windows установите Visual Studio Build Tools с инструментами MSVC C++ для архитектуры хоста и Windows SDK. Запускайте команды в Developer PowerShell для этой архитектуры.

В Windows при работе с диском VirtualBox Shared Folders (в этой рабочей копии `Y:`) выполните в корне проекта перед установкой и запуском команд:

```powershell
$env:NPM_CONFIG_WORKSPACE_DIR = (Get-Location).Path
$env:npm_config_node_linker = 'hoisted'
$env:CHOKIDAR_USEPOLLING = 'true'
$env:CARGO_TARGET_DIR = Join-Path $env:LOCALAPPDATA 'interwar-command/target'
```

Первая переменная сохраняет букву сетевого диска при обнаружении workspace. Режим `hoisted` позволяет обойти ограничение VirtualBox на создание каталогов-ссылок, polling обеспечивает наблюдение Vite за изменениями файлов. Cargo использует локальный каталог для промежуточных файлов и исполняемых тестов. На обычном локальном диске действует стандартная установка pnpm.

1. Установите [rustup](https://rustup.rs/) и [Node.js 22.16.0](https://nodejs.org/dist/v22.16.0/). Если используете nvm, выполните `nvm install 22.16.0` и `nvm use 22.16.0`.
2. Установите Rust с WASM target, wasm-pack и pnpm:

   ```sh
   rustup toolchain install 1.100.0 --profile minimal --component rustfmt,clippy --target wasm32-unknown-unknown
   cargo install wasm-pack --version 0.13.1 --locked
   npm install --global pnpm@10.11.1
   ```

   Можно также распаковать [wasm-pack 0.13.1](https://github.com/rustwasm/wasm-pack/releases/tag/v0.13.1) в каталог из `PATH`. Проверьте `rustc --version`, `wasm-pack --version`, `node --version` и `pnpm --version`. Для сборки требуется доступный из shell исполняемый файл `wasm-pack`.

3. Первый запуск установки выполняется командой `pnpm install`. Для воспроизводимой установки из сохранённого lockfile выполните `pnpm install --frozen-lockfile`. В репозитории закреплены версии в `rust-toolchain.toml`, `.node-version`, манифестах пакетов, `Cargo.lock` и `pnpm-lock.yaml`.
4. Установите браузер для тестов:

   ```sh
   pnpm --filter @interwar/web --fail-if-no-match exec playwright install chromium
   ```

   На Linux с отсутствующими системными библиотеками используйте `playwright install --with-deps chromium` через тот же `pnpm --filter @interwar/web --fail-if-no-match exec`.

### Повторный запуск на macOS

После установки зависимостей откройте терминал в каталоге `interwar-command` и выполните `pnpm dev` от своего пользователя. Если при установке пакетов возникает `ENOMEM`, повторите загрузку с одним сетевым запросом за раз, используя уже скачанные пакеты:

```sh
npm_config_network_concurrency=1 pnpm install --frozen-lockfile --prefer-offline
```

## Запуск и проверка

```sh
pnpm dev
```

Откройте адрес Vite из терминала (обычно `http://127.0.0.1:5173`). На первом запуске wasm-pack подготавливает CLI wasm-bindgen версии из Cargo.lock. Для проверки выберите клетку, передвиньте карту и выберите другую клетку после масштабирования. Для `(2, 3)` панель показывает `5`.

| Команда из корня | Результат |
|---|---|
| `pnpm wasm:build` | Выполняет `wasm-pack build crates/game-wasm --target web --out-dir pkg` |
| `pnpm dev` | Генерирует WASM и запускает Vite |
| `pnpm typecheck` | Генерирует WASM и объявления, затем выполняет `tsc --noEmit` |
| `pnpm lint` | ESLint для приложения, тестов и конфигурации TS |
| `pnpm test` | Нативные тесты Rust и Vitest для геометрии renderer |
| `pnpm build` | Подготавливает WASM, проверяет типы и создаёт `apps/web/dist` |
| `pnpm test:e2e` | Собирает клиент, запускает Vite preview на `127.0.0.1:4173` и проверяет карту в Chromium |
| `pnpm check` | Rust fmt/clippy, unit-тесты обоих языков, lint, typecheck, production build и browser smoke |

Чтобы открыть production-сборку вручную, выполните `pnpm build`, затем `pnpm --filter @interwar/web --fail-if-no-match exec vite preview --host 127.0.0.1`. Браузеру требуется WebGL. В smoke test Playwright запускает и останавливает собственный preview, для него нужен свободный порт 4173.

Отдельные проверки Rust:

```sh
cargo fmt --all --check
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
```

## Устройство проекта

| Путь | Назначение |
|---|---|
| `crates/game-core` | Целочисленный Hex, шесть направлений и расстояние |
| `crates/game-wasm` | Экспорт расстояния через wasm-bindgen. Сгенерированные JS, типы и бинарный модуль появляются в игнорируемом каталоге `pkg` |
| `crates/game-ai` | Минимальный crate для будущего T-012 |
| `apps/web/src/game` | React-панель, состояние загрузки и вызов WASM |
| `apps/web/src/renderer` | Рисование PixiJS, выбор по пикселям и камера |
| `apps/web/e2e` | Браузерная проверка production-сборки |
| `content/scenarios` | Каталог будущих сценариев |

Границы модулей и жизненный цикл описаны в [архитектуре](docs/ARCHITECTURE.md). Нормативные требования находятся в [SPEC.md](SPEC.md), объём первого этапа — в [FIRST_TASK.md](FIRST_TASK.md), фактические результаты — в [PROGRESS.md](PROGRESS.md). [AGENTS.md](AGENTS.md) задаёт правила разработки.
