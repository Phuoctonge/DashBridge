const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'shared', 'bounded-journal.js'), 'utf8');
const context = { globalThis: {} };
vm.createContext(context);
vm.runInContext(source, context);

const journal = { events: [], nextEventId: 0 };
for (let index = 0; index < 10; index += 1) {
    context.globalThis.DashBridgeBoundedJournal.pushEvent(journal, { id: ++journal.nextEventId }, 3);
}
assert.deepStrictEqual(Array.from(journal.events, event => event.id), [8, 9, 10]);
assert.strictEqual(journal.totalEvents, 10);
assert.strictEqual(journal.droppedEvents, 7);
assert.strictEqual(journal.eventLimit, 3);

const records = {};
for (let index = 0; index < 5; index += 1) {
    context.globalThis.DashBridgeBoundedJournal.setRecentRecord(records, `request-${index}`, { index }, 2);
}
assert.deepStrictEqual(Object.keys(records), ['request-3', 'request-4']);

console.log('PASS bounded diagnostic journals retain only the newest evidence');
