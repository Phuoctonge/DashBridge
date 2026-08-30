'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const timers = [];
const makeElement = tag => ({
    tag, className: '', textContent: '', innerHTML: '', style: {}, children: [], removed: false,
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); },
    remove() { this.removed = true; },
});
const context = {
    document: { createElement: makeElement, createTextNode: text => ({ textContent: text }) },
    setTimeout(callback) { timers.push(callback); return timers.length; },
    Date,
};
vm.createContext(context);
vm.runInContext(`${fs.readFileSync(path.join(__dirname, '..', 'pages/batch/batch-ui.js'), 'utf8')}\n;globalThis.__batchPageUi = BatchPageUi;`, context);

const toastContainer = makeElement('div');
context.__batchPageUi.createNotifier(toastContainer)('<unsafe>', 'unknown');
assert.strictEqual(toastContainer.children.length, 1);
assert.strictEqual(toastContainer.children[0].children[1].textContent, '<unsafe>', 'toast messages use textContent');
assert.match(toastContainer.children[0].children[0].innerHTML, /toast-icon-info/, 'unknown types use the info icon');
timers.shift()();
assert.match(toastContainer.children[0].style.animation, /toastFadeOut/);
timers.shift()();
assert.strictEqual(toastContainer.children[0].removed, true);

const logContainer = makeElement('div');
logContainer.scrollTop = 0;
logContainer.scrollHeight = 42;
context.__batchPageUi.createLogger(logContainer)('<failure>', true);
assert.match(logContainer.children[0].className, /log-error/);
assert.strictEqual(logContainer.children[0].children[1].textContent, ' <failure>', 'log messages use text nodes');
assert.strictEqual(logContainer.scrollTop, 42);
console.log('PASS Batch UI helpers render text safely and release transient toasts');
