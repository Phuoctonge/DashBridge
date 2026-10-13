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
    localStorage: { getItem: key => legacyValues[key] ?? null }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/shared/grafana-time.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('js/shared/grafana-panel-bootstrap.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('pages/dashbridge/dashbridge-time-state.js', 'utf8'), context);
const state = vm.runInContext('DashBridgeTimeState', context);
const reportNow = 1788955200000;
assert.deepStrictEqual(JSON.parse(JSON.stringify(state.forReport({ from: 'now-1h', to: 'now', refresh: '5s' }, reportNow))),
    { from: String(reportNow - 3600000), to: String(reportNow), refresh: '' });
assert.throws(() => state.forReport({ from: 'now/d', to: 'now' }), /абсолютный/);
assert.throws(() => state.forReport({ from: 'now+1h', to: 'now' }), /позже/);

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

// Grafana 12.2 solo ignores ISO URL endpoints and queries its fallback period.
// Exercise the real shared codec: mocking it to always return milliseconds
// previously hid the incompatible inherited format.
const isoSource = 'https://grafana.example/d-solo/uid/name?panelId=138&orgId=1'
    + '&from=2026-09-08T14%3A49%3A17.146Z&to=2026-09-08T15%3A37%3A56.429Z'
    + '&timezone=Europe%2FMoscow&var-project=RussPass&var-station=%24__all';
const absoluteRange = { from: '2026-08-26T22:57:39.463+03:00',
    to: '2026-08-27T03:47:28.851+03:00', refresh: '30s' };
const absoluteUrl = new URL(state.applyToUrl(isoSource, absoluteRange));
assert.strictEqual(absoluteUrl.searchParams.get('from'), '1787774259463',
    'an ISO source URL must not make Grafana ignore the selected absolute start');
assert.strictEqual(absoluteUrl.searchParams.get('to'), '1787791648851');
assert.strictEqual(absoluteUrl.searchParams.get('timezone'), 'Europe/Moscow');
assert.strictEqual(absoluteUrl.searchParams.get('var-project'), 'RussPass');
assert.strictEqual(absoluteUrl.searchParams.get('var-station'), '$__all');
assert.strictEqual(absoluteUrl.searchParams.get('refresh'), '30s');
assert.strictEqual(state.formatForUrl(isoSource, absoluteRange.from), '1787774259463',
    'iframe time updates must use the same supported absolute codec as navigation');
assert.strictEqual(state.formatForUrl(isoSource, '1787774259463'), '1787774259463');
assert.strictEqual(state.formatForUrl(isoSource, 'now-1h'), 'now-1h');
assert.strictEqual(state.formatForUrl(isoSource, 'now/d'), 'now/d');
assert.strictEqual(new URL(isoSource).searchParams.get('from'), '2026-09-08T14:49:17.146Z',
    'formatting a runtime URL must leave the persisted source untouched');

console.log('PASS DashBridge time state normalizes profile settings and reads legacy migration values');
