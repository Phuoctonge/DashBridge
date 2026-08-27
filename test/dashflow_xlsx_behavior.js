'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const JSZip = require('../vendor/jszip.min.js');

(async () => {
    const context = { JSZip, Uint8Array };
    context.globalThis = context; vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'shared', 'dashflow-xlsx.js'), 'utf8'), context);

    const bytes = await context.DashBridgeComparisonXlsx.build({
        title: 'Login & replay', generatedAt: '2026-08-24T05:00:00.000Z',
        urlFilter: 'russpass', statusFilter: 'all',
        steps: [
            { id: 1, action: 'navigate https://russpass.ru/', navigationUrl: '' },
            { id: 2, action: 'click Продолжить', navigationUrl: 'https://russpass.ru/profile' },
        ],
        items: [
            {
                stepId: 2, status: 'changed', method: 'GET', url: 'https://api.russpass.ru/a?x=1&y=<2>',
                baseline: { status: 200, mimeType: 'application/json', bodySha256: 'old' },
                current: { status: 201, mimeType: 'application/json', bodySha256: 'new' }, differences: ['status', 'body hash'],
            },
            {
                stepId: 2, status: 'added', method: 'POST', url: 'https://api.russpass.ru/b',
                baseline: null, current: { status: 200, mimeType: 'application/json', bodySha256: 'hash' }, differences: [],
            },
        ],
    });
    assert(bytes instanceof Uint8Array && bytes.length > 1000, 'export must produce a non-empty XLSX byte array');
    const zip = await JSZip.loadAsync(bytes);
    for (const name of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'xl/worksheets/sheet3.xml']) {
        assert(zip.file(name), `XLSX must contain ${name}`);
    }
    const workbook = await zip.file('xl/workbook.xml').async('string');
    const summary = await zip.file('xl/worksheets/sheet1.xml').async('string');
    const details = await zip.file('xl/worksheets/sheet2.xml').async('string');
    const technical = await zip.file('xl/worksheets/sheet3.xml').async('string');
    assert(workbook.includes('name="Итоги"') && workbook.includes('name="Различия"') && workbook.includes('name="Технические данные"'), 'workbook must contain summary, details and technical sheets');
    assert(summary.includes('COUNTIF(') && summary.includes('COUNTIFS(') && summary.includes('Различия'), 'summary must use auditable formulas');
    assert(summary.includes('Фильтр URL') && summary.includes('russpass'), 'summary must describe the applied URL filter');
    assert(details.includes('https://api.russpass.ru/a?x=1&amp;y=&lt;2&gt;'), 'URLs must be XML-escaped without losing content');
    assert(details.includes('<autoFilter ref="A3:J5"/>') && details.includes('state="frozen"'), 'details must provide filters and frozen headers');
    assert(details.indexOf('<autoFilter ') < details.indexOf('<mergeCells '), 'OOXML requires autoFilter before mergeCells for Microsoft Excel compatibility');
    assert(!details.includes('Baseline SHA-256') && technical.includes('Baseline SHA-256') && technical.includes('old'), 'full SHA-256 values must move to a dedicated technical sheet');
    console.log('PASS DashFlow comparison exports a structured local XLSX report');
})().catch(error => { console.error(error); process.exitCode = 1; });
