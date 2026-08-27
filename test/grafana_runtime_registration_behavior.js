'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const registered = [];
const context = {
    URL,
    chrome: {
        scripting: {
            async getRegisteredContentScripts({ ids }) {
                if (ids.includes('dashbridge-grafana-main-runtime-v1')) return [];
                return registered.filter(script => ids.includes(script.id));
            },
            async registerContentScripts(scripts) { registered.push(...scripts); }
        }
    }
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'shared', 'grafana-runtime-manifest.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'shared', 'grafana-runtime.js'), 'utf8'), context);

(async () => {
    const result = await context.ensureEarlyGrafanaRuntimeForUrl('https://grafana.test/company/grafana/d/uid/name');
    assert.strictEqual(result.ok, true);
    assert.strictEqual(registered.length, 1);
    assert.strictEqual(registered[0].runAt, 'document_start');
    assert(registered[0].matches.includes('*://grafana.test/*/d/*'));
    const again = await context.ensureEarlyGrafanaRuntimeForUrl('https://grafana.test/d-solo/uid/name');
    assert.strictEqual(again.alreadyRegistered, true);
    assert.strictEqual(registered.length, 1, 'same host must not create a wrapper chain');
    console.log('PASS explicit Grafana runtime registration covers base paths before navigation');
})().catch(error => { console.error(error); process.exit(1); });
