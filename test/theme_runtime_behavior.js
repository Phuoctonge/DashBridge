const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const documentListeners = new Map();
const buttonListeners = new Map();
const button = {
    textContent: '',
    title: '',
    hasAttribute: () => false,
    appendChild() {},
    addEventListener(type, listener) { buttonListeners.set(type, listener); }
};
const attributes = new Map();
const document = {
    readyState: 'loading',
    documentElement: {
        getAttribute: key => attributes.get(key) || null,
        setAttribute: (key, value) => attributes.set(key, value)
    },
    getElementById: id => (id === 'themeToggle' && document.readyState !== 'loading' ? button : null),
    createElement: () => ({ className: '', innerHTML: '', textContent: '', appendChild() {} }),
    addEventListener(type, listener) { documentListeners.set(type, listener); }
};
const values = new Map();
const context = {
    document,
    localStorage: { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) },
    chrome: {
        storage: {
            sync: { get: (_keys, callback) => callback({}), set() {} },
            onChanged: { addListener() {} }
        }
    },
    window: { dispatchEvent() {} },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } }
};

vm.runInNewContext(fs.readFileSync('pages/shared/theme.js', 'utf8'), context, { filename: 'theme.js' });
assert.strictEqual(attributes.get('data-theme'), 'light', 'a new installation must apply the light theme before DOM readiness');
assert.ok(documentListeners.has('DOMContentLoaded'), 'theme button setup must wait for DOM readiness');

document.readyState = 'complete';
documentListeners.get('DOMContentLoaded')();
assert.ok(buttonListeners.has('click'), 'theme button must receive a click handler after DOM readiness');
buttonListeners.get('click')();
assert.strictEqual(attributes.get('data-theme'), 'dark', 'theme click must toggle the root theme');
assert.strictEqual(values.get('dashbridge-theme'), 'dark', 'theme click must persist the new theme');

console.log('PASS theme runtime binds and toggles after DOM readiness');
