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
assert(storage.verifyPlan(pairedAnchorResult.html, { additions: [{ newFilename: 'load.png', caption: 'Load Average', insertion: { groupTitle: 'Метрики серверов системы', testTitle: 'Тест 1', beforeFilename: 'average.png' } }] }));
assert.strictEqual(storage.verifyPlan(pairedAnchorResult.html, { additions: [{ newFilename: 'load.png', caption: 'Load Average', insertion: { groupTitle: 'Другая группа', testTitle: 'Тест 1', beforeFilename: 'average.png' } }] }), false);
assert.strictEqual(storage.verifyPlan('<h3>Тест 1</h3><h5>Метрики серверов системы</h5><p>CPU Usage</p><ac:image><ri:attachment ri:filename="old.png" /></ac:image><p>CPU Usage</p><ac:image><ri:attachment ri:filename="new.png" /></ac:image>', { additions: [{ newFilename: 'new.png', caption: 'CPU Usage', insertion: { groupTitle: 'Метрики серверов системы', testTitle: 'Тест 1' } }] }), true);
console.log('PASS Confluence report storage transformation');
const imageBlock = filename => `<ac:image><ri:attachment ri:filename="${filename}" /></ac:image>`;
const filenames = value => [...value.matchAll(/ri:filename="([^"]+)"/g)].map(match => match[1]);
const repeatedHtml = '<h3>T1</h3><h4>G</h4><p>CPU</p>' + imageBlock('old.png') + '<p>Memory</p>' + imageBlock('old.png') + '<h3>T2</h3><h4>G</h4><p>CPU</p>' + imageBlock('old.png');
const offsets = [...repeatedHtml.matchAll(/<ac:image\b/g)].map(match => match.index);
for (const index of [0, 1, 2]) {
    const targeted = storage.transform(repeatedHtml, { replacements: [{ oldFilename: 'old.png', newFilename: 'new.png', sourceOffset: offsets[index] }] });
    assert.deepStrictEqual(filenames(targeted.html), ['old.png', 'old.png', 'old.png'].map((name, position) => position === index ? 'new.png' : name));
}
for (const sourceOffset of [-1, offsets[1] + 1, repeatedHtml.length, '0']) assert.throws(() => storage.transform(repeatedHtml, { replacements: [{ oldFilename: 'old.png', newFilename: 'new.png', sourceOffset }] }), /Replacement target/);
assert.throws(() => storage.transform(repeatedHtml, { replacements: [{ oldFilename: 'other.png', newFilename: 'new.png', sourceOffset: offsets[0] }] }), /Replacement target/);
assert.throws(() => storage.transform(repeatedHtml, { replacements: [{ oldFilename: 'old.png', newFilename: 'a.png', sourceOffset: offsets[0] }, { oldFilename: 'old.png', newFilename: 'b.png', sourceOffset: offsets[0] }] }), /Conflicting replacement/);
const occurrencePlan = [{ oldFilename: 'old.png', newFilename: 'a.png', occurrence: 0 }, { oldFilename: 'old.png', newFilename: 'b.png', occurrence: 1 }];
for (const replacements of [occurrencePlan, occurrencePlan.slice().reverse()]) assert.deepStrictEqual(filenames(storage.transform(repeatedHtml, { replacements }).html), ['a.png', 'b.png', 'old.png']);
const cascadePlan = [{ oldFilename: 'a.png', newFilename: 'b.png' }, { oldFilename: 'b.png', newFilename: 'c.png' }];
for (const replacements of [cascadePlan, cascadePlan.slice().reverse()]) assert.deepStrictEqual(filenames(storage.transform(imageBlock('a.png') + imageBlock('b.png'), { replacements }).html), ['b.png', 'c.png']);
const anchoredPlan = { replacements: [{ oldFilename: 'old.png', newFilename: 'new.png', sourceOffset: offsets[1] }], additions: [{ newFilename: 'insert.png', caption: 'Insert', insertion: { testTitle: 'T1', groupTitle: 'G', beforeFilename: 'old.png', beforeSourceOffset: offsets[1] } }] };
const anchored = storage.transform(repeatedHtml, anchoredPlan);
assert.deepStrictEqual(filenames(anchored.html), ['old.png', 'insert.png', 'new.png', 'old.png']);
assert(anchored.html.indexOf('insert.png') < anchored.html.indexOf('<p>Memory</p>'));
assert(storage.verifyPlan(anchored.html, { ...anchoredPlan, expectedStorageHtml: anchored.html }));
assert.strictEqual(storage.verifyPlan(anchored.html.replace('ri:filename="new.png"', 'ri:filename="old.png"').replace('ri:filename="old.png"', 'ri:filename="new.png"'), { expectedStorageHtml: anchored.html }), false);
assert.strictEqual(storage.verifyPlan(anchored.html.replace('ri:filename="old.png"', 'ri:filename="new.png"'), { expectedStorageHtml: anchored.html }), false);
assert(storage.verifyPlan(anchored.html.replaceAll('ri:filename="', "ri:filename='" ).replace(/\.png"/g, ".png'"), { expectedStorageHtml: anchored.html }));
console.log('PASS Confluence report original target identity and verification');

for (const wrapped of [
    '<p>CPU' + imageBlock('old.png') + '</p><p>Memory' + imageBlock('old.png') + '</p>',
    '<p>' + imageBlock('old.png') + '</p><p>' + imageBlock('old.png') + '</p>',
]) {
    const source = '<h3>T1</h3><h4>G</h4>' + wrapped;
    const beforeSourceOffset = [...source.matchAll(/<ac:image\b/g)][1].index;
    const output = storage.transform(source, { additions: [{ newFilename: 'insert.png', caption: 'Insert',
        insertion: { testTitle: 'T1', groupTitle: 'G', beforeFilename: 'old.png', beforeSourceOffset } }] }).html;
    assert.deepStrictEqual(filenames(output), ['old.png', 'insert.png', 'old.png'],
        'paragraph-contained anchor must not select a previous image paragraph');
    assert(output.includes('</p><p>Insert</p>'), 'insertion must keep paragraph boundaries');
}

const additionsHtml = '<h3>T1</h3><h4>G</h4><p>CPU</p>' + imageBlock('cpu.png') + '<p>Memory</p>' + imageBlock('memory.png') + '<h3>T2</h3><h4>G</h4><p>CPU</p>' + imageBlock('second.png');
const appendPlan = { additions: ['Disk', 'Network'].map(caption => ({ newFilename: `${caption.toLowerCase()}.png`, caption, insertion: { kind: 'group-item', testTitle: 'T1', groupTitle: 'G' } })) };
const appended = storage.transform(additionsHtml, appendPlan).html;
assert.deepStrictEqual(filenames(appended), ['cpu.png', 'memory.png', 'disk.png', 'network.png', 'second.png'], 'Unanchored graphs must follow existing graphs in submitted order');
assert.strictEqual(appended.slice(appended.indexOf('<h3>T2')), additionsHtml.slice(additionsHtml.indexOf('<h3>T2')));
assert(storage.verifyPlan(appended, appendPlan));
console.log('PASS Confluence graph append order');

vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'pages', 'confluence-report', 'confluence-report-scanner.js'), 'utf8'), context);
const scan = value => JSON.parse(JSON.stringify(context.DashBridgeConfluenceReportScanner.fromStorageHtml(value).tests));
const groupPlan = { additions: [{ newFilename: 'disk.png', caption: 'Disk', insertion: { kind: 'group', testTitle: 'T1', groupTitle: 'G', sectionTitle: 'Extra' } }] };
const grouped = storage.transform(additionsHtml, groupPlan).html;
const groups = scan(grouped)[0].groups;
assert.deepStrictEqual(groups.map(group => [group.headingPath, group.images.map(image => image.imageReference.filename)]), [
    [['G'], ['cpu.png', 'memory.png']], [['G', 'Extra'], ['disk.png']],
], 'New nested group must not take ownership of existing images');
assert.strictEqual(grouped.slice(grouped.indexOf('<h3>T2')), additionsHtml.slice(additionsHtml.indexOf('<h3>T2')));
assert(storage.verifyPlan(grouped, groupPlan));
assert.strictEqual(storage.verifyPlan(grouped.replace('<h5>Extra</h5>', '<h4>Extra</h4>'), { ...groupPlan, expectedStorageHtml: grouped }), false, 'Verification must reject a group moved outside its parent with the same image sequence');
assert.throws(() => storage.transform('<h3>T1</h3><h6>G</h6>', groupPlan), /вложенную группу/);
console.log('PASS Confluence nested group ownership');

const sectionPlan = { additions: [{ newFilename: 'disk.png', caption: 'Disk', insertion: { kind: 'section', testTitle: 'T1', sectionTitle: 'Extra' } }] };
const sectioned = storage.transform(additionsHtml, sectionPlan).html;
assert.deepStrictEqual(scan(sectioned).map(test => test.groups.map(group => [group.title, group.images.map(image => image.imageReference.filename)])), [
    [['G', ['cpu.png', 'memory.png']], ['Extra', ['disk.png']]], [['G', ['second.png']]],
], 'A section belongs to the selected test, before the next h3');
assert(storage.verifyPlan(sectioned, sectionPlan));
const misplacedSection = additionsHtml + '<h4>Extra</h4><p>Disk</p>' + imageBlock('disk.png');
assert.strictEqual(storage.verifyPlan(misplacedSection, sectionPlan), false, 'Verification must reject a section saved under another test');
assert.throws(() => storage.transform(additionsHtml, { additions: [{ ...sectionPlan.additions[0], insertion: { ...sectionPlan.additions[0].insertion, testTitle: 'Missing' } }] }), /Target test not found/);
console.log('PASS Confluence selected test section placement and verification');
