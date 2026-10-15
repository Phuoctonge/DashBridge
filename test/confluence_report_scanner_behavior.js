'use strict';
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const vm = require('vm');
const context = { globalThis: null }; context.globalThis = context; vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'pages', 'confluence-report', 'confluence-report-scanner.js'), 'utf8'), context);
const scanner = context.DashBridgeConfluenceReportScanner;
const html = '<h1>Отчёт</h1><h2>Детализация</h2><h3>Тест 1. Сценарий</h3><h5>Метрики серверов системы</h5><p>На рисунке далее CPU.</p><ac:image><ri:attachment ri:filename="cpu-1.png" /></ac:image><p>На рисунке далее диск.</p><ac:image><ri:attachment ri:filename="disk-1.png" /></ac:image><h3>Тест 2. Другой</h3><h5>Метрики серверов системы</h5><p>На рисунке далее CPU.</p><ac:image><ri:attachment ri:filename="cpu-2.png" /></ac:image>';
const snapshot = scanner.fromStorageHtml(html, { pageIdentity: { pageId: '42' } });
assert.strictEqual(snapshot.tests.length, 2); assert.strictEqual(snapshot.tests[0].groups[0].images.length, 2);
assert.strictEqual(snapshot.tests[0].groups[0].images[0].imageReference.filename, 'cpu-1.png');
assert.strictEqual(snapshot.tests[0].groups[0].images[0].caption, 'На рисунке далее CPU.');
assert.strictEqual(snapshot.tests[0].groups[0].images[0].occurrence, 0); assert.strictEqual(snapshot.tests[1].groups[0].images[0].occurrence, 0);
assert.strictEqual(snapshot.tests[0].groups[0].images[0].captionLead, 'CPU');
assert.strictEqual(snapshot.tests[0].groups[0].images[0].captionDetails, '');
assert.ok(snapshot.tests[0].groups[0].images[0].headingPath.includes('Метрики серверов системы'));
assert.strictEqual(snapshot.tests[0].groups[0].normalizedGroupFamily, 'метрики серверов системы');
const rich = scanner.fromStorageHtml('<h3>Тест 11</h3><h4>Метрики сервера приложения Демо12</h4><p>На графике ниже представлен рост времени ответа. Сравнение выполнено после прогрева.</p><ac:image><ri:attachment ri:filename="x.png" /></ac:image>');
const richImage = rich.tests[0].groups[0].images[0];
assert.strictEqual(richImage.captionLead, 'рост времени ответа');
assert.strictEqual(richImage.captionDetails, 'Сравнение выполнено после прогрева.');
assert.strictEqual(rich.tests[0].groups[0].normalizedGroupFamily, 'метрики сервера приложения демо');
console.log('PASS report snapshot scanner');

for (const [paragraph, expectedCaption] of [
    ['<p class="wrapped"><ac:image><ri:attachment ri:filename="wrapped.png" /></ac:image></p>', 'CPU'],
    ['<p><strong>Memory</strong><ac:image><ri:attachment ri:filename="wrapped.png" /></ac:image></p>', 'Memory'],
    ['<p><img src="/wrapped.png"></p>', 'CPU'],
]) {
    const storage = '<h3>Test</h3><h4>Group</h4><p>CPU</p>' + paragraph;
    const images = scanner.fromStorageHtml(storage).tests[0].groups[0].images;
    assert.strictEqual(images.length, 1, 'paragraph wrapper must not hide an image');
    assert.strictEqual(images[0].caption, expectedCaption);
    assert.strictEqual(images[0].sourceLocation.offset, storage.indexOf(paragraph.includes('<ac:image') ? '<ac:image' : '<img'));
}
console.log('PASS report scanner sees paragraph-wrapped images and preserves source offsets');
