const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const context = { window: {}, AbortController };
context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js/pages/batch-run-lifecycle.js'), 'utf8'), context);

const first = context.BatchRunLifecycle.begin();
assert.strictEqual(context.BatchRunLifecycle.isActive(first), true);
let cleaned = 0;
context.BatchRunLifecycle.registerCleanup(first, () => cleaned++);

context.BatchRunLifecycle.cancel();
assert.strictEqual(cleaned, 1);
const second = context.BatchRunLifecycle.begin();
assert.strictEqual(context.BatchRunLifecycle.finish(first), false, 'an old run must not finish a newer run');
assert.strictEqual(context.BatchRunLifecycle.isActive(second), true);
assert.strictEqual(context.BatchRunLifecycle.finish(second), true);
assert.strictEqual(context.BatchRunLifecycle.isActive(second), false);

console.log('[OK] Batch run lifecycle behavior');
