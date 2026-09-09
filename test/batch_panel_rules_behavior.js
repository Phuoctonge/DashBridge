const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const root = path.resolve(__dirname, '..');
const storage = {};
const context = {
    navigator: { locks: { request: (_, callback) => callback() } },
    console,
    URL,
    chrome: {
        storage: {
            local: {
                async get(key) { return { [key]: storage[key] }; },
                async set(value) { Object.assign(storage, value); }
            }
        }
    }
};
context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'js/shared/grafana-url.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(root, 'js/shared/grafana-batch-panel-rules.js'), 'utf8'), context);

async function main() {
    const url = 'https://grafana.example.test/d/infra-overview?orgId=1&from=now-1h';
    const otherUrl = 'https://grafana.example.test/d/other-dashboard?orgId=1';
    await context.BatchPanelRules.save(url, {
        '12': { removeFill: true, thickenLines: true, thickenLinesValue: 30, invertIdle: true },
        '18': { convertMemToUsed: true },
        '19': { thickenLinesValue: 2 }
    });

    const rules = await context.BatchPanelRules.load(url);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(rules)), {
        '12': { removeFill: true, thickenLines: true, thickenLinesValue: 5, invertIdle: true },
        '18': { convertMemToUsed: true }
    });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(await context.BatchPanelRules.load(otherUrl))), {});
    assert.notStrictEqual(
        context.BatchPanelRules.dashboardKey(url),
        context.BatchPanelRules.dashboardKey('https://grafana.example.test/d/infra-overview?orgId=2'),
        'rules from different Grafana organizations must not share a key'
    );
    assert.deepStrictEqual(JSON.parse(JSON.stringify(context.BatchPanelRules.forPanel(rules, '12'))), {
        removeFill: true, thickenLines: true, thickenLinesValue: 5, invertIdle: true, targetPanelId: '12'
    });
    assert.strictEqual(context.BatchPanelRules.forPanel(rules, '999'), null);
    await context.BatchPanelRules.save(url, {});
    assert.deepStrictEqual(JSON.parse(JSON.stringify(await context.BatchPanelRules.load(url))), {});
    await context.BatchPanelRules.save(url, {
        6: { convertMemToUsed: true, seriesQueryFilterEnabled: true, seriesQueryFilterValue: 40,
            seriesQueryFilterMode: 'last', seriesQueryFilterHighlightEnabled: false,
            thresholdEnabled: true, thresholdValue: 75 },
        8: { seriesQueryFilterValue: 100, thresholdValue: 50 }
    });
    const advanced = await context.BatchPanelRules.load(url);
    assert.strictEqual(advanced[8], undefined);
    assert.strictEqual(advanced[6].seriesQueryFilterRawValue, 40);
    assert.strictEqual(advanced[6].seriesFilterSettingsVersion, 2);
    assert.strictEqual(advanced[6].seriesQueryFilterMode, 'last');
    assert.strictEqual(advanced[6].seriesQueryFilterHighlightEnabled, false);
    assert.strictEqual(advanced[6].thresholdRawValue, 75);
    assert.strictEqual(advanced[6].thresholdNotifyEnabled, false);
    assert.strictEqual(context.BatchPanelRules.forPanel(advanced, 6).thresholdEnabled, true);
    console.log('[OK] Batch panel rules behavior');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
