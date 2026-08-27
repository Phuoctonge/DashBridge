'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const listeners = new Map();
const observers = [];

function RootHTMLElement() {}
const rootCalls = [];
const originalRootFocus = function(options) {
    rootCalls.push(options);
};
RootHTMLElement.prototype.focus = originalRootFocus;

function ChildHTMLElement() {}
const originalChildFocus = function() {};
ChildHTMLElement.prototype.focus = originalChildFocus;

const styles = new Map();
const iframeDocument = {
    head: {
        appendChild(style) {
            styles.set(style.id, style);
        },
    },
    createElement() {
        return {
            remove() {
                styles.delete(this.id);
            },
        };
    },
    getElementById(id) {
        return styles.get(id) || null;
    },
};
const iframe = {
    contentDocument: iframeDocument,
    contentWindow: { HTMLElement: ChildHTMLElement },
};

class FakeMutationObserver {
    constructor(callback) {
        this.callback = callback;
        this.disconnected = false;
        observers.push(this);
    }
    observe() {}
    disconnect() {
        this.disconnected = true;
    }
}

const context = {
    console,
    HTMLElement: RootHTMLElement,
    MutationObserver: FakeMutationObserver,
    document: {
        documentElement: {},
        getElementById: id => id === 'editor-a' ? iframe : null,
    },
    location: { origin: 'https://wiki.example.test' },
};
context.window = context;
context.window.location = context.location;
context.window.addEventListener = (type, listener) => listeners.set(type, listener);
context.window.postMessage = () => {};

vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js/content/inject.js'), 'utf8'), context);
const sandboxWindow = vm.runInContext('window', context);
const send = data => listeners.get('message')({
    origin: context.location.origin,
    source: sandboxWindow,
    data,
});

send({ type: 'SET_CONFLUENCE_FIX', value: true, iframeIds: ['editor-a'] });
assert.notStrictEqual(RootHTMLElement.prototype.focus, originalRootFocus);
assert.notStrictEqual(ChildHTMLElement.prototype.focus, originalChildFocus);
assert.strictEqual(styles.has('scroll-fix-style'), true);

const enabledOptions = { focusVisible: true };
RootHTMLElement.prototype.focus.call({}, enabledOptions);
assert.deepStrictEqual(enabledOptions, { focusVisible: true },
    'the established Confluence options object must not be mutated');
assert.strictEqual(rootCalls[0].focusVisible, true);
assert.strictEqual(rootCalls[0].preventScroll, true);

const iframeOptions = { focusVisible: false };
ChildHTMLElement.prototype.focus.call({}, iframeOptions);
assert.deepStrictEqual(iframeOptions, { focusVisible: false });
assert.strictEqual(rootCalls[1].focusVisible, false);
assert.strictEqual(rootCalls[1].preventScroll, true);

send({ type: 'SET_CONFLUENCE_FIX', value: false, iframeIds: ['editor-a'] });
assert.strictEqual(styles.has('scroll-fix-style'), false);
assert.strictEqual(observers[0].disconnected, true);
assert.notStrictEqual(RootHTMLElement.prototype.focus, originalRootFocus,
    'the proven cross-Wiki wrapper architecture must remain installed');

const disabledOptions = { focusVisible: true };
RootHTMLElement.prototype.focus.call({}, disabledOptions);
assert.strictEqual(rootCalls[2], disabledOptions,
    'disabled mode must forward the exact untouched options object');
assert.strictEqual(rootCalls[2].preventScroll, undefined,
    'disabled mode must restore native scrolling behavior');

console.log('PASS Confluence keeps the legacy cross-Wiki patch and cleanly disables preventScroll');
