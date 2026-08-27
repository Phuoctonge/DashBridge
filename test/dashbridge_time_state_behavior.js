'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const legacyValues = {
    dashbridge_timeFrom: 'now-6h',
    dashbridge_timeTo: 'now',
    dashbridge_refresh: '30s'
};
const context = {
    URL, Date, Number, String,
    localStorage: { getItem: key => legacyValues[key] ?? null },
    parseGrafanaAbsoluteTime: () => null,
    serializeGrafanaAbsoluteTime: value => String(value),
    detectGrafanaTimeFormat: () => 'milliseconds'
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/pages/dashbridge-time-state.js', 'utf8'), context);
const state = vm.runInContext('DashBridgeTimeState', context);

assert.deepStrictEqual(JSON.parse(JSON.stringify(state.defaults())), {
    from: 'now-1h', to: 'now', refresh: ''
});
assert.deepStrictEqual(JSON.parse(JSON.stringify(state.load())), {
    from: 'now-6h', to: 'now', refresh: '30s'
});
assert.deepStrictEqual(JSON.parse(JSON.stringify(state.normalize({
    from: 'now-24h', to: 'now', refresh: '5m'
}))), { from: 'now-24h', to: 'now', refresh: '5m' });
assert.deepStrictEqual(JSON.parse(JSON.stringify(state.normalize({ from: '' }))), {
    from: 'now-1h', to: 'now', refresh: ''
});
assert.deepStrictEqual(JSON.parse(JSON.stringify(state.normalize({
    from: 'now-2h', to: 'now', refresh: '1ms'
}))), { from: 'now-2h', to: 'now', refresh: '' });
assert.strictEqual(
    new URL(state.applyToUrl('https://grafana.example/d-solo/x?refresh=5s', {
        from: 'now-1h', to: 'now', refresh: 'unexpected'
    })).searchParams.has('refresh'),
    false
);

console.log('PASS DashBridge time state normalizes profile settings and reads legacy migration values');
