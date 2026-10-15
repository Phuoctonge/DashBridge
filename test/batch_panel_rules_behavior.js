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
        7: { cpuCapacityFilterEnabled: true, cpuCapacityFilterCoefficient: 0.8,
            cpuCapacityFilterMode: 'last', cpuCapacityFilterHighlightEnabled: false,
            cpuCapacityFilterLoad1: true, cpuCapacityFilterLoad5: true,
            forceMemByteUnit: true },
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
    assert.strictEqual(advanced[7].cpuCapacityFilterEnabled, true);
    assert.strictEqual(advanced[7].cpuCapacityFilterCoefficient, 0.8);
    assert.strictEqual(advanced[7].cpuCapacityFilterMode, 'last');
    assert.strictEqual(advanced[7].cpuCapacityFilterHighlightEnabled, false);
    assert.strictEqual(advanced[7].cpuCapacityFilterLoad5, true);
    assert.strictEqual(advanced[7].cpuCapacityFilterLoad15, undefined);
    assert.strictEqual(advanced[7].forceMemByteUnit, true);
    assert.strictEqual(context.BatchPanelRules.forPanel(advanced, 6).thresholdEnabled, true);
    await context.BatchPanelRules.save(url, {
        9: { convertMemToUsed: true, forceMemByteUnit: true,
            seriesQueryFilterEnabled: true, cpuCapacityFilterEnabled: true }
    });
    const exclusive = await context.BatchPanelRules.load(url);
    assert.strictEqual(exclusive[9].forceMemByteUnit, undefined);
    assert.strictEqual(exclusive[9].cpuCapacityFilterEnabled, undefined);
    const concurrentUrl = 'https://grafana.example.test/d/concurrent?orgId=1';
    const initial = await context.BatchPanelRules.load(concurrentUrl);
    await context.BatchPanelRules.save(concurrentUrl, { 1: { removeFill: true } }, { baseRules: initial });
    await context.BatchPanelRules.save(concurrentUrl, { 2: { invertLegend: true } }, { baseRules: initial });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(await context.BatchPanelRules.load(concurrentUrl))), {
        1: { removeFill: true }, 2: { invertLegend: true }
    }, 'stale editors adding different panels must preserve both rules');
    const base = await context.BatchPanelRules.load(concurrentUrl);
    await context.BatchPanelRules.save(concurrentUrl, { ...base, 1: { invertIdle: true } }, { baseRules: base });
    await assert.rejects(context.BatchPanelRules.save(concurrentUrl,
        { ...base, 1: { thickenLines: true }, 3: { removeFill: true } }, { baseRules: base }),
    error => error.code === 'batch-rules-conflict', 'same-panel conflict must reject the entire save');
    assert.strictEqual((await context.BatchPanelRules.load(concurrentUrl))[3], undefined);
    await assert.rejects(context.BatchPanelRules.save(concurrentUrl, { 2: base[2] }, { baseRules: base }),
        error => error.code === 'batch-rules-conflict', 'deleting a concurrently edited panel must conflict');
    await assert.rejects(context.BatchPanelRules.save(concurrentUrl, {}, { baseRules: base, reset: true }),
        error => error.code === 'batch-rules-conflict', 'reset must not erase concurrent edits');
    const fresh = await context.BatchPanelRules.load(concurrentUrl);
    await context.BatchPanelRules.save(concurrentUrl, { ...fresh, 4: { removeFill: true } }, { baseRules: fresh });
    await assert.rejects(context.BatchPanelRules.save(concurrentUrl, {}, { baseRules: fresh, reset: true }),
        error => error.code === 'batch-rules-conflict', 'reset must not erase newly added panels');
    await context.BatchPanelRules.save(concurrentUrl, { 1: fresh[1] }, { baseRules: fresh });
    assert.deepStrictEqual(Object.keys(await context.BatchPanelRules.load(concurrentUrl)), ['1', '4'],
        'deleting an unchanged panel must preserve an unrelated concurrent addition');
    const stable = await context.BatchPanelRules.load(concurrentUrl);
    await context.BatchPanelRules.save(concurrentUrl, { ...stable, 1: { invertLegend: true } }, { baseRules: stable });
    await context.BatchPanelRules.save(concurrentUrl, { ...stable, 4: { invertIdle: true } }, { baseRules: stable });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(await context.BatchPanelRules.load(concurrentUrl))), {
        1: { invertLegend: true }, 4: { invertIdle: true }
    }, 'editing another panel must preserve an unseen concurrent change');
    await context.BatchPanelRules.save(concurrentUrl, { ...stable, 4: { invertIdle: true } }, { baseRules: stable });
    assert.strictEqual((await context.BatchPanelRules.load(concurrentUrl))[1].invertLegend, true,
        'an identical concurrent result is safe to retry without restoring stale unchanged rules');
    console.log('[OK] Batch panel rules behavior');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
