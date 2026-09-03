# МЭШ: все задания

Кросс-браузерное расширение для Chromium и Firefox/LibreWolf. Расширение локально сканирует открытую страницу МЭШ, собирает найденные карточки заданий и показывает их в едином интерфейсе. Для Chromium используется Manifest V3, а для Firefox/LibreWolf сборщик создаёт Manifest V2 с `background.scripts`, что совместимо с конфигурациями LibreWolf, где MV3 service worker отключён.

Расширение не получает и не хранит пароль или API-токен МЭШ и не отправляет задания на внешний сервер. Тесты открываются в оригинальном интерфейсе МЭШ.

## Сборка

Требуется Python 3.9+; Node.js не нужен.

Linux/macOS:

```bash
chmod +x scripts/build-extension.sh
./scripts/build-extension.sh
```

Windows:

```bat
scripts\build-extension.bat
```

Результаты:

```text
dist/chrome/
dist/firefox/
dist/mesh-tasks-chrome.zip
dist/mesh-tasks-firefox.zip
```

## Установка в LibreWolf

Открой `about:debugging#/runtime/this-firefox`, нажми **«Загрузить временное дополнение»** и выбери `dist/firefox/manifest.json`. Выбирать нужно именно Firefox-сборку, а не `dist/chrome/manifest.json`. После перезапуска LibreWolf временное дополнение может потребоваться загрузить повторно.

## Установка в Chromium

Открой `chrome://extensions`, включи **режим разработчика**, нажми **«Загрузить распакованное расширение»** и выбери каталог `dist/chrome/`.

После установки открой страницу домашних заданий на `school.mos.ru` или `dnevnik.mos.ru` и нажми **«Собрать задания»**.

## Ограничения MVP

Сканер использует эвристики DOM и `MutationObserver` не требуется для автоматического обновления уже сохранённого результата: для нового результата нужно снова нажать кнопку. Cross-origin iframe и внутренний тестовый плеер не сканируются; кнопки материалов ведут в оригинальные ссылки МЭШ.
