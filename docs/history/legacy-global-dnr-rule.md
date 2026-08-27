# Удалённое глобальное DNR-правило

До миграции существовал отключённый пример правила, снимавшего `X-Frame-Options`
и `Content-Security-Policy` со всех `sub_frame` через `urlFilter: "*"`. Оно не
используется и было удалено после перехода на session rules с одновременными
ограничениями по `grafanaIframeDomains`, `resourceTypes: ['sub_frame']` и
`condition.tabIds` конкретных вкладок `dashbridge.html`.

Возвращать глобальное правило нельзя: оно меняет защитные заголовки iframe на
посторонних страницах. Актуальная реализация находится в
`js/shared/dnr-rules.js` и `js/background.js`.
