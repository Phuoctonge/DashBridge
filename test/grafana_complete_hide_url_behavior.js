'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const context = { URL, URLSearchParams };
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/shared/grafana-url.js', 'utf8'), context);

const result = new URL(context.applyGrafanaCompleteHideSelection(
    'https://grafana.example.test/d/infra/linux?orgId=7&viewPanel=12&dashbridgeLegendFilter=legacy#keep=value',
    [' CPU Load ', 'CPU Load', 'Memory Used'],
    ['{"refId":"A"}', '{"refId":"A"}', '{"refId":"B"}']
));
const hash = new URLSearchParams(result.hash.slice(1));

assert.strictEqual(result.searchParams.has('dashbridgeLegendSelection'), false);
assert.strictEqual(result.searchParams.has('dashbridgeTargetQuerySignatures'), false);
assert.strictEqual(result.searchParams.has('dashbridgeLegendFilter'), false);
assert.strictEqual(hash.get('keep'), 'value');
assert.deepStrictEqual(JSON.parse(hash.get('dashbridgeLegendSelection')), {
    version: 2,
    visibleSeries: ['CPU Load', 'Memory Used']
});
assert.deepStrictEqual(JSON.parse(hash.get('dashbridgeTargetQuerySignatures')), [
    '{"refId":"A"}',
    '{"refId":"B"}'
]);

const empty = new URL(context.applyGrafanaCompleteHideSelection(result.toString(), [], []));
const emptyHash = new URLSearchParams(empty.hash.slice(1));
assert.deepStrictEqual(JSON.parse(emptyHash.get('dashbridgeLegendSelection')), {
    version: 2,
    visibleSeries: []
});
assert.strictEqual(emptyHash.has('dashbridgeTargetQuerySignatures'), false);

console.log('  ✓ Group Batch complete-hide state stays in the local URL fragment');
