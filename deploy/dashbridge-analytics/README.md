# DashBridge Analytics — VPS deployment

Стек рассчитан на существующий Caddy и отдельную внешнюю Docker-сеть
`analytics_private`. Он не публикует порт на host и хранит SQLite только в
`./data`. Пароль проверяет штатный bcrypt-модуль Caddy, а не приложение.
Публичный ingestion ограничен общим token bucket без хранения IP; нормальный
клиент отправляет не более одной пачки в час. Панель показывает технические
счётчики приёма без тел запросов и сетевых идентификаторов.

## Локальная визуальная разработка

Из корня репозитория запустите:

```powershell
.\scripts\Start-AnalyticsDev.ps1
```

Скрипт создаёт отдельную `.dev-data/normal/analytics.sqlite` с синтетическими
агрегатами, открывает `http://127.0.0.1:18080/admin/` и запускает Node watch.
`-ResetData` пересоздаёт fixtures. Dev bypass административного gateway
разрешён только вместе с loopback `HOST`, поэтому его нельзя случайно включить
на публичном интерфейсе. Production SQLite никогда не используется.

## Установка через Dockge

Production-контейнер использует готовый `node:24-alpine` и bind-mounted файлы,
поэтому при обычной публикации image не собирается. Для первой установки
скопируйте весь каталог в `/opt/stacks/dashbridge-analytics-bootstrap`, затем:

```bash
cd /opt/stacks/dashbridge-analytics-bootstrap
sudo ./ops/bootstrap-vps.sh dashbridge-deploy
```

Добавьте сеть `analytics_private` сервису Caddy в его Compose и пересоздайте
только Caddy. Bootstrap уже запускает `analytics` через Compose; в Dockge
откройте созданный стек `/opt/stacks/dashbridge-analytics`, а не bootstrap-каталог.
Повторный bootstrap перезаписывает app/Compose/helper и пересоздаёт контейнер,
поэтому обычные обновления выполняйте publish-командой ниже.

## Публикация без Docker build

Изменения отправляются из корня Windows-репозитория:

```powershell
.\scripts\Publish-Analytics.ps1 -RemoteHost 82.202.142.88 -IdentityFile "$env:USERPROFILE/.ssh/dashbridge-analytics-deploy"
```

Команда выше использует ключ текущей рабочей станции. На другом ПК укажите
свой путь через `-IdentityFile`; содержимое приватного ключа в проект не копируется.

Скрипт прогоняет тесты, загружает только `server.js`,
`analytics-contract.js` и `public/`, проверяет SHA-256 и вызывает узкий root
helper. Изменение только `public/` видно после обновления страницы без restart;
изменение backend вызывает короткий restart контейнера. `data/` не входит в
release и остаётся подключённым. Перед переключением создаётся backup кода;
неуспешный health-check автоматически восстанавливает предыдущую версию.

Compose и root helper не принимаются из публикуемого архива: они изменяются
только отдельной административной процедурой. Это не позволяет ограниченному
deploy-пользователю расширить собственные sudo/Docker-полномочия.

Это ограничение состава release, а не изоляция от публикуемого кода:
deploy-пользователь может менять `server.js`, который работает с `/data`.
Helper принимает архив до 4 МиБ, проверяет entries до extraction и итоговый
staging до 8 МиБ; код обновляется пофайловым rename, не одним атомарным swap
каталога. `rollback` при провале health восстанавливает backup поверх app и
пересоздаёт контейнер; впервые добавленные файлы этим не удаляются. `/health`
подтверждает ответ процесса, а не полную проверку ingestion/admin. Старые
code backups helper удаляет после 30 дней, SQLite backups в этот механизм не входят.
Эти контракты сверяются с
[`dashbridge-analytics-apply`](ops/dashbridge-analytics-apply) и
[`deployment.test.js`](test/deployment.test.js); тест deployment проверяет
структуру scripts, а не выполняет реальное переключение VPS.

## Caddy

Добавьте в `/opt/stacks/caddy/Caddyfile`:

```caddyfile
analytics.tongehub.com {
    header {
        Strict-Transport-Security "max-age=31536000;"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "no-referrer"
    }
    @public path /health /v1/events/batch
    handle @public {
        reverse_proxy dashbridge-analytics:8080 {
            header_up -X-DashBridge-Admin
            header_up -X-Forwarded-For
            header_up -X-Real-IP
            header_up -Forwarded
        }
    }
    handle {
        basic_auth {
            admin ВСТАВЬТЕ_BCRYPT_ХЕШ
        }
        reverse_proxy dashbridge-analytics:8080 {
            header_up X-DashBridge-Admin {http.auth.user.id}
            header_up -X-Forwarded-For
            header_up -X-Real-IP
            header_up -Forwarded
        }
    }
}
```

Получите bcrypt-хеш интерактивно командой `docker exec -it caddy caddy
hash-password`, не помещая пароль в аргументы или shell history. Используйте
случайный пароль минимум из 24 символов. Не добавляйте `log` в этот site block:
Caddy access log по умолчанию выключен. Приложение также не логирует запросы и
не имеет колонки для IP. После изменения:

```bash
docker exec caddy caddy validate --config /etc/caddy/Caddyfile
docker exec caddy caddy reload --config /etc/caddy/Caddyfile
curl -fsS https://analytics.tongehub.com/health
```

`requireAdmin` в [`server.js`](server.js) доверяет только значению header
`X-DashBridge-Admin`, не проверяя пароль самостоятельно. Не публикуйте backend
port и допускайте в `analytics_private` только доверенные контейнеры: соседний
контейнер может отправить header напрямую. Caddy всё равно видит IP в момент
соединения; отключение access log означает отсутствие его хранения этим
site block. Конфигурацию иных proxy/firewall logs проверяют отдельно.

Ingestion принимает JSON до 256 КиБ; общий token bucket имеет burst 60 и
пополнение один запрос за 30 секунд. Он намеренно не использует IP, поэтому
не удостоверяет installation UUID и при исчерпании квоты отклоняет также
легитимные пачки. `MAX_DATABASE_MIB` по умолчанию 512 (минимум 64) проверяет
занятые SQLite pages плюс WAL перед batch и возвращает 507 при превышении;
это оценка, не жёсткая файловая квота. Retention выполняется на старте и
ежедневно; свободные страницы SQLite могут остаться в файле.

## Проверка админки и синтетические сценарии

Из корня проекта: `scripts/Start-AnalyticsDev.ps1 -Scenario catalog -NoBrowser`.
Доступны `normal`, `empty`, `sparse`, `large`, `upgrade`, `catalog`, `outcomes`,
`delivery`. Каждый сценарий хранится в `.dev-data/<scenario>`; шапка DEV
показывает версию fixtures и дату создания. `catalog` покрывает весь каталог,
`large` содержит 64 800 агрегатов, `upgrade` — последовательные обновления.
Все события проходят production-валидатор. Счётчик effective равен единице
для уникального сочетания установки, дня, функции и dimensions.

Существующая база автоматически не обновляется. Остановите preview перед
`-ResetData`: помеченная синтетическая база сохраняется как `.backup-*`,
непомеченная база не перезаписывается. Прямой seed принимает
`--scenario=... --date=YYYY-MM-DD` и `DATA_DIR`; это позволяет воспроизводить
сценарии, не затрагивая старую `.dev-data/analytics.sqlite`.

Admin API дополнительно принимает `surface`, `outcome`, `renderer`, `failure`.
Для таблиц `features`, `problems`, `versions`, `installations`, `actions`,
`dimensions` доступны `<table>Page` (с нуля), `<table>Sort` (ключ колонки) и
`<table>Direction` (`asc`/`desc`). Сортировка охватывает всю выборку и имеет
стабильный порядок равных значений. Ответ `pagination` содержит `page`,
`pageSize`, `total`, `hasMore`: actions по 100 строк, остальные по 50.
Отчёт использует календарные дни UTC; версии в выборке отделены от последних
наблюдаемых версий по сохранённой истории. Пустые результаты не равны 0% ошибок.

Проверки: `node --test deploy/dashbridge-analytics/test/*.test.js` и
`scripts/audit-analytics-ui.py` (переменная `DASHBRIDGE_ANALYTICS_URL` позволяет
выбрать локальный порт). UI проверяет клавиатурные диалоги, фильтры, reset и
прокрутку на шести размерах экрана. Production не участвует в этих проверках.

## Резервное копирование SQLite

SQLite работает в WAL. Для согласованной копии команда ниже использует
`VACUUM INTO`, а не простое копирование живого файла. Целевой `backup.sqlite`
не должен существовать: повтор команды с прежним файлом завершится ошибкой.

```bash
docker exec dashbridge-analytics node -e "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('/data/analytics.sqlite');d.exec(\"VACUUM INTO '/data/backup.sqlite'\");d.close()"
```

Затем перенесите `/opt/stacks/dashbridge-analytics/data/backup.sqlite` в
закрытый backup-каталог и удалите промежуточный файл после проверки копии.
Удаляйте backup-файлы старше `RETENTION_DAYS` тем же расписанием: серверный
retention не может автоматически удалить внешнюю копию.
