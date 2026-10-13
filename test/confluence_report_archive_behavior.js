'use strict';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const vm = require('vm');
const context = { globalThis: null }; context.globalThis = context; vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'pages', 'confluence-report', 'confluence-report-archive.js'), 'utf8'), context);
const analyzer = context.DashBridgeConfluenceReportArchive;
const archive = { manifest: { captures: [
    { file: '01 [26.08] 23h00-23h48/panel-2_CPU_Usage_1787774400000_1787777280000_hash.png', panelId: '2', panelTitle: 'CPU_Usage', from: '1787774400000', to: '1787777280000', rangeIndex: 0 },
    { file: '01 [26.08] 23h00-23h48/panel-6_Memory_1787774400000_1787777280000_hash.png', panelId: '6', panelTitle: 'Memory', from: '1787774400000', to: '1787777280000', rangeIndex: 0 },
    { file: '02 [26.08 23h54] - [27.08 00h26]/panel-2_CPU_Usage_1787777640000_1787779560000_hash.png', panelId: '2', panelTitle: 'CPU_Usage', from: '1787777640000', to: '1787779560000', rangeIndex: 1 }
] }, sources: new Map([['01 [26.08] 23h00-23h48/panel-2_CPU_Usage_1787774400000_1787777280000_hash.png', { path: '01 [26.08] 23h00-23h48/panel-2_CPU_Usage_1787774400000_1787777280000_hash.png' }]]) };
const result = analyzer.analyze(archive);
assert.strictEqual(result.ranges.length, 2);
assert.strictEqual(result.ranges[0].panels.length, 2);
assert.strictEqual(result.ranges[0].panels[0].panelId, '2');
assert.strictEqual(result.ranges[0].panels[0].title, 'CPU Usage');
assert.strictEqual(result.ranges[1].rangeIndex, 2);
assert.strictEqual(result.ranges[0].panels[0].source.path, archive.manifest.captures[0].file);
console.log('PASS Confluence report archive analysis');
const series = analyzer.analyze({manifest: {captures: [0,1].map(occurrence=>({
    file: `01/series-${occurrence}.png`, panelId: '2', panelTitle: 'CPU', seriesName: 'node', occurrence,
    rangeIndex: 0, from: '1787774400000', to: '1787777280000',
}))}});
assert.strictEqual(series.panels.length, 2, 'equal series names with different occurrences must remain separately selectable');
