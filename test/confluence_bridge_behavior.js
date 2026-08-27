'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const storageListeners = [];
const messageListeners = [];
const posted = [];
const context = {
    console,
    location: { host: 'wiki.example.test', hostname: 'wiki.example.test', origin: 'https://wiki.example.test' },
    getGrafanaSettingsDefaults: () => ({ grafanaIframeDomains: [], grafanaCompactScreenshot: false }),
    getGrafanaSettingsStorageKeys: () => ['grafanaIframeDomains', 'grafanaCompactScreenshot'],
    normalizeGrafanaSettings: settings => ({
        grafanaIframeDomains: [], grafanaCompactScreenshot: false, ...settings
    }),
    Event: function Event(type) { this.type = type; },
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init?.detail; },
    document: {
        documentElement: { dataset: {} },
        head: { appendChild() {} },
        dispatchEvent() {},
        addEventListener() {},
        getElementById: id => id === 'confluence-fix-loader' ? {} : null,
        createElement: () => ({}),
    },
    chrome: {
        runtime: { getURL: value => `chrome-extension://test/${value}` },
        storage: {
            sync: {
                get(keys, callback) {
                    if (Array.isArray(keys)) {
                        callback({
                            confluenceScrollFixEnabled: false,
                            wikiDomains: 'wiki.example.test',
                            wikiIframeIds: 'editor-a',
                        });
                    } else {
                        callback({ grafanaIframeDomains: [], grafanaCompactScreenshot: false });
                    }
                },
                set() {},
            },
            onChanged: { addListener: listener => storageListeners.push(listener) },
        },
    },
};
context.window = context;
context.window.location = context.location;
context.window.addEventListener = (type, listener) => {
    if (type === 'message') messageListeners.push(listener);
};
context.window.postMessage = message => posted.push(message);

vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js/content/content.js'), 'utf8'), context);

storageListeners.forEach(listener => listener({
    confluenceScrollFixEnabled: { oldValue: false, newValue: true },
}, 'sync'));
storageListeners.forEach(listener => listener({
    wikiIframeIds: { oldValue: 'editor-a', newValue: 'editor-b, editor-c' },
}, 'sync'));

const commands = posted.filter(message => message.type === 'SET_CONFLUENCE_FIX');
assert.strictEqual(commands.length, 2);
assert.strictEqual(commands[0].value, true);
assert.strictEqual(commands[1].value, true, 'changing iframe IDs must retain the latest enabled state');
assert.deepStrictEqual(Array.from(commands[1].iframeIds), ['editor-b', 'editor-c']);

storageListeners.forEach(listener => listener({
    confluenceScrollFixEnabled: { oldValue: true, newValue: false },
}, 'local'));
assert.strictEqual(posted.filter(message => message.type === 'SET_CONFLUENCE_FIX').length, 2,
    'local storage changes must not drive the sync settings bridge');

console.log('PASS Confluence bridge retains current state across independent setting changes');
