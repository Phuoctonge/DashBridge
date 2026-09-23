'use strict';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const vm = require('vm');
const context = { globalThis: null }; context.globalThis = context; vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'pages', 'confluence-report', 'confluence-report-storage.js'), 'utf8'), context);
const storage = context.DashBridgeConfluenceReportStorage;
const html = '<h4>Метрики</h4><p>Старая подпись</p><ac:image><ri:attachment ri:filename="old.png" /></ac:image><p>После</p>';
const result = storage.transform(html, { replacements: [{ oldFilename: 'old.png', newFilename: 'new.png' }] });
assert(result.html.includes('ri:filename="new.png"')); assert(result.html.includes('style="width: 100%;"')); assert(result.html.includes('Старая подпись')); assert.strictEqual(result.applied.length, 1);
assert.throws(() => storage.transform(html, { replacements: [{ oldFilename: 'missing.png', newFilename: 'new.png' }] }), /Attachment not found/);
const headingLevelHtml = '<h5>Метрики серверов системы</h5><ac:image><ri:attachment ri:filename="anchor.png" /></ac:image>';
const headingLevelResult = storage.transform(headingLevelHtml, { additions: [
    { newFilename: 'cpu.png', caption: 'CPU Usage', insertion: { groupTitle: 'Метрики серверов системы', beforeFilename: 'anchor.png' } },
    { newFilename: 'load.png', caption: 'Load Average', insertion: { groupTitle: 'Метрики серверов системы', beforeFilename: 'anchor.png' } },
] });
assert(headingLevelResult.html.indexOf('cpu.png') < headingLevelResult.html.indexOf('anchor.png'));
assert(headingLevelResult.html.indexOf('load.png') < headingLevelResult.html.indexOf('anchor.png'));
console.log('PASS Confluence report storage transformation');
