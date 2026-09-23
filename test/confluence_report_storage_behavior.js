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
assert.throws(() => storage.transform('<h5>Другая группа</h5>', { additions: [{ newFilename: 'x.png', caption: 'CPU', insertion: { groupTitle: 'Метрики серверов системы' } }] }), /Target group not found/);
const duplicateGroupsHtml = '<h3>Тест 1</h3><h5>Данные с нагрузочных станций</h5><ac:image><ri:attachment ri:filename="load-1.png" /></ac:image><h5>Метрики серверов системы</h5><ac:image><ri:attachment ri:filename="cpu-1.png" /></ac:image><h3>Тест 2</h3><h5>Данные с нагрузочных станций</h5><ac:image><ri:attachment ri:filename="load-2.png" /></ac:image><h5>Метрики серверов системы</h5><ac:image><ri:attachment ri:filename="cpu-2.png" /></ac:image>';
const scoped = storage.transform(duplicateGroupsHtml, { additions: [
    { newFilename: 'new-1.png', caption: 'CPU Usage', insertion: { groupTitle: 'Метрики серверов системы', testTitle: 'Тест 1', beforeFilename: 'cpu-1.png' } },
    { newFilename: 'new-2.png', caption: 'CPU Usage', insertion: { groupTitle: 'Метрики серверов системы', testTitle: 'Тест 2', beforeFilename: 'cpu-2.png' } },
] });
assert(scoped.html.indexOf('new-1.png') < scoped.html.indexOf('cpu-1.png'));
assert(scoped.html.indexOf('new-1.png') > scoped.html.indexOf('load-1.png'));
assert(scoped.html.indexOf('new-2.png') < scoped.html.indexOf('cpu-2.png'));
assert(scoped.html.indexOf('new-2.png') > scoped.html.indexOf('load-2.png'));
assert(scoped.html.indexOf('new-1.png') < scoped.html.indexOf('load-2.png'));
const encodedTitleHtml = '<h3>Тест 1. Поиск максимальной производительности по сценарию &quot;Бронь бесплатной экскурсии&quot;</h3><h5>Метрики серверов системы</h5><ac:image><ri:attachment ri:filename="cpu-encoded.png" /></ac:image>';
const encodedTitleResult = storage.transform(encodedTitleHtml, { additions: [{ newFilename: 'encoded.png', caption: 'CPU Usage', insertion: { groupTitle: 'Метрики серверов системы', testTitle: 'Тест 1. Поиск максимальной производительности по сценарию "Бронь бесплатной экскурсии"', beforeFilename: 'cpu-encoded.png' } }] });
assert(encodedTitleResult.html.indexOf('encoded.png') < encodedTitleResult.html.indexOf('cpu-encoded.png'));
const nonFirstAnchorHtml = '<h3>Тест 1</h3><h5>Метрики серверов системы</h5><ac:image><ri:attachment ri:filename="first.png" /></ac:image><ac:image><ri:attachment ri:filename="anchor-second.png" /></ac:image>';
const nonFirstAnchorResult = storage.transform(nonFirstAnchorHtml, { additions: [{ newFilename: 'between.png', caption: 'CPU Usage', insertion: { groupTitle: 'Метрики серверов системы', testTitle: 'Тест 1', beforeFilename: 'anchor-second.png' } }] });
assert(nonFirstAnchorResult.html.indexOf('first.png') < nonFirstAnchorResult.html.indexOf('between.png'));
assert(nonFirstAnchorResult.html.indexOf('between.png') < nonFirstAnchorResult.html.indexOf('anchor-second.png'));
const pairedAnchorHtml = '<h3>Тест 1</h3><h5>Метрики серверов системы</h5><p>среднюю загруженность</p><ac:image><ri:attachment ri:filename="average.png" /></ac:image><p>использование памяти</p><ac:image><ri:attachment ri:filename="memory.png" /></ac:image>';
const pairedAnchorResult = storage.transform(pairedAnchorHtml, { additions: [{ newFilename: 'load.png', caption: 'Load Average', insertion: { groupTitle: 'Метрики серверов системы', testTitle: 'Тест 1', beforeFilename: 'average.png' } }] });
assert(pairedAnchorResult.html.indexOf('load.png') < pairedAnchorResult.html.indexOf('среднюю загруженность'));
assert(pairedAnchorResult.html.indexOf('среднюю загруженность') < pairedAnchorResult.html.indexOf('average.png'));
console.log('PASS Confluence report storage transformation');
