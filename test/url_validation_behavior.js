'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const context = { URL };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'shared', 'url-validation.js'), 'utf8'), context);

assert.strictEqual(context.normalizeHttpBaseOrigin('HTTPS://Example.COM:443/'), 'https://example.com');
assert.strictEqual(context.normalizeHttpBaseOrigin('https://example.com/jira'), null);
assert.strictEqual(context.normalizeHttpBaseUrl('https://Example.COM/jira/'), 'https://example.com/jira');
assert.strictEqual(context.normalizeHttpBaseOrigin('https://user:pass@example.com'), null);
assert.strictEqual(context.normalizeHttpOrigin('https://example.com/browse/ABC-1?x=1'), 'https://example.com');
assert.strictEqual(context.normalizeHttpHost('Example.COM.:8443/path'), 'example.com:8443');
assert.strictEqual(context.normalizeHttpHost('javascript:alert(1)'), null);

console.log('PASS URL policy canonicalizes exact HTTP origins and rejects credentials');
