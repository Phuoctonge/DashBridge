# DashBridge Analytics — VPS deployment

Стек рассчитан на существующий Caddy и отдельную внешнюю Docker-сеть
`analytics_private`. Он не публикует порт на host и хранит SQLite только в
`./data`. Пароль проверяет штатный bcrypt-модуль Caddy, а не приложение.
Публичный ingestion ограничен общим token bucket без хранения IP; нормальный
клиент отправляет не более одной пачки в час. Панель показывает технические
счётчики приёма без тел запросов и сетевых идентификаторов.

## Установка через Dockge

Скопируйте весь каталог в `/opt/stacks/dashbridge-analytics`, затем на VPS:

```bash
cd /opt/stacks/dashbridge-analytics
install -d -o 10001 -g 10001 -m 750 data
docker network create analytics_private
docker compose config --quiet
```

Добавьте сеть `analytics_private` сервису Caddy в его Compose и пересоздайте
только Caddy. После этого откройте стек в Dockge и нажмите Deploy.

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

## Резервное копирование

SQLite работает в WAL. Для согласованной копии используйте `.backup`, а не
простое копирование живого файла:

```bash
docker exec dashbridge-analytics node -e "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('/data/analytics.sqlite');d.exec(\"VACUUM INTO '/data/backup.sqlite'\");d.close()"
```

Затем перенесите `/opt/stacks/dashbridge-analytics/data/backup.sqlite` в
закрытый backup-каталог и удалите промежуточный файл после проверки копии.
Удаляйте backup-файлы старше `RETENTION_DAYS` тем же расписанием: серверный
retention не может автоматически удалить внешнюю копию.
