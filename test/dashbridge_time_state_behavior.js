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
    URL, URLSearchParams, Date, Number, String,
    localStorage: { getItem: key => legacyValues[key] ?? null },
    parseGrafanaAbsoluteTime: value => {
        const text = String(value || '');
        const milliseconds = /^\d{13}$/.test(text) ? Number(text) : Date.parse(text);
        return Number.isFinite(milliseconds) ? milliseconds : null;
    },
    serializeGrafanaAbsoluteTime: value => String(value),
    detectGrafanaTimeFormat: () => 'milliseconds'
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/shared/grafana-panel-bootstrap.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('pages/dashbridge/dashbridge-time-state.js', 'utf8'), context);
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
assert.strictEqual(state.formatForLabel('2026-08-27 10:40:48', '2026-08-27 12:40:58'),
    '27.08.2026 10:40–12:40', 'same-day header labels must omit seconds and timezone');
assert.strictEqual(state.formatForLabel('2026-08-27 22:00:48', '2026-08-28 01:15:58'),
    '27.08 22:00–28.08 01:15', 'cross-day labels in one year must stay compact');
assert.strictEqual(state.formatForLabel('2026-12-31 23:59:59', '2027-01-01 00:01:01'),
    '31.12.2026 23:59–01.01.2027 00:01', 'cross-year labels must keep both years');
const offUrl = new URL(state.applyToUrl('https://grafana.example/d-solo/x?refresh=5s', {
        from: 'now-1h', to: 'now', refresh: 'unexpected'
    }));
assert.strictEqual(offUrl.searchParams.has('refresh'), false);
assert.strictEqual(new URLSearchParams(offUrl.hash.slice(1)).get('dashbridgeRefresh'), 'off');
const activeUrl = new URL(state.applyToUrl(offUrl.toString(), {
    from: 'now-1h', to: 'now', refresh: '30s'
}));
assert.strictEqual(activeUrl.searchParams.get('refresh'), '30s');
assert.strictEqual(new URLSearchParams(activeUrl.hash.slice(1)).has('dashbridgeRefresh'), false);

console.log('PASS DashBridge time state normalizes profile settings and reads legacy migration values');
