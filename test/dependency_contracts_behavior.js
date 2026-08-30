'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyzeProject, explainFile } = require('../scripts/check-dependency-contracts');

function write(root, file, contents) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
}

function fixture({ brokenReference = false, brokenOrder = false, missingDom = false } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dashbridge-dependencies-'));
    write(root, 'manifest.json', JSON.stringify({
        manifest_version: 3,
        background: { service_worker: brokenReference ? 'js/missing.js' : 'js/background.js' },
        action: { default_popup: 'popup.html' },
    }));
    write(root, 'popup.html', `<main id="ready"></main>\n<script src="js/${brokenOrder ? 'consumer' : 'provider'}.js"></script>\n<script src="js/${brokenOrder ? 'provider' : 'consumer'}.js"></script>`);
    write(root, 'js/background.js', `'use strict';`);
    write(root, 'js/provider.js', `globalThis.DashBridgeFixture = Object.freeze({ ok: true });`);
    write(root, 'js/consumer.js', `document.getElementById('${missingDom ? 'missing' : 'ready'}').textContent = '';\nvoid globalThis.DashBridgeFixture;`);
    return root;
}

const goodRoot = fixture();
const good = analyzeProject(goodRoot);
assert.deepStrictEqual(good.errors, [], good.errors.join('\n'));
assert(explainFile(good, 'js/provider.js').incoming.some(edge => edge.from === 'popup.html'));

const missing = analyzeProject(fixture({ brokenReference: true }));
assert(missing.errors.some(error => error.includes('js/missing.js')));

const order = analyzeProject(fixture({ brokenOrder: true }));
assert(order.errors.some(error => error.includes('consumes global DashBridgeFixture before')));

const dom = analyzeProject(fixture({ missingDom: true }));
assert(dom.errors.some(error => error.includes('missing DOM id #missing')));

console.log('[OK] dependency contracts behavior');
