'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
let requestedUrl = null;
const payload = { dashboard: { panels: [
    { id: 9, title: 'Bottom', gridPos: { x: 0, y: 8 }, targets: [] },
    { id: 3, title: 'Top right', gridPos: { x: 12, y: 0 }, targets: [] },
    { id: 2, title: 'Top left', gridPos: { x: 0, y: 0 }, targets: [] }
] } };
const context = {
    URL,
    fetch: async url => {
        requestedUrl = String(url);
        return {
            ok: true, status: 200, redirected: false, url: requestedUrl,
            headers: { get: name => name.toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null },
            json: async () => payload
        };
    }
};
context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'js/shared/grafana-url.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(root, 'js/shared/grafana-dashboard-api.js'), 'utf8'), context);

(async () => {
    const parsed = context.parseGrafanaDashboardUrl('https://grafana.example.test/monitoring/grafana/d/infra/linux?orgId=7');
    assert.strictEqual(parsed.baseUrl, 'https://grafana.example.test/monitoring/grafana');
    assert.strictEqual(parsed.basePath, '/monitoring/grafana');
    const result = await context.fetchGrafanaDashboardPanels('https://grafana.example.test/monitoring/grafana/d/infra/linux?orgId=7');
    assert.strictEqual(requestedUrl, 'https://grafana.example.test/monitoring/grafana/api/dashboards/uid/infra?orgId=7');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(result.panelList.map(panel => panel.id))), ['2', '3', '9']);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(result.panels)), { '2': 'Top left', '3': 'Top right', '9': 'Bottom' });
    console.log('[OK] Grafana dashboard API base path and panel inventory');
})().catch(error => { console.error(error); process.exit(1); });
