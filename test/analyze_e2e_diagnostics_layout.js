'use strict';

// Finds byte-level section and per-test boundaries in a multi-gigabyte,
// single-line DashBridge report without parsing or materialising the JSON.
const fs = require('fs');

const file = process.argv[2];
if (!file) {
    console.error('Usage: node test/analyze_e2e_diagnostics_layout.js <report.json>');
    process.exit(2);
}

const markers = [
    ',"aiIndex":',
    ',"evidenceStorage":',
    ',"results":[',
    '],"visualStates":',
    ',"assets":',
    '"images":{',
    '"domSnapshots":{',
    '"diagnosticEvents":{',
    '"performanceResources":{',
];
const testPrefix = Buffer.from('{"id":"');
const categorySuffix = '","category":';
const markerBuffers = new Map(markers.map(marker => [marker, Buffer.from(marker)]));
const hits = Object.fromEntries(markers.map(marker => [marker, []]));
const tests = [];
const fd = fs.openSync(file, 'r');
const chunk = Buffer.alloc(16 * 1024 * 1024);
const overlapBytes = 512;
let carry = Buffer.alloc(0);
let position = 0;

for (;;) {
    const bytes = fs.readSync(fd, chunk, 0, chunk.length, position);
    if (!bytes) break;
    const window = Buffer.concat([carry, chunk.subarray(0, bytes)]);
    const windowOffset = position - carry.length;
    for (const [marker, pattern] of markerBuffers) {
        let cursor = 0;
        while ((cursor = window.indexOf(pattern, cursor)) >= 0) {
            const absolute = windowOffset + cursor;
            const records = hits[marker];
            if (records[records.length - 1] !== absolute) records.push(absolute);
            cursor += pattern.length;
        }
    }
    let cursor = 0;
    while ((cursor = window.indexOf(testPrefix, cursor)) >= 0) {
        const idStart = cursor + testPrefix.length;
        const idEnd = window.indexOf(categorySuffix, idStart, 'utf8');
        if (idEnd >= 0 && idEnd - idStart <= 24) {
            const absolute = windowOffset + cursor;
            if (tests[tests.length - 1]?.offset !== absolute) {
                tests.push({ id: window.subarray(idStart, idEnd).toString('utf8'), offset: absolute });
            }
        }
        cursor += testPrefix.length;
    }
    carry = window.subarray(Math.max(0, window.length - overlapBytes));
    position += bytes;
}
fs.closeSync(fd);

const root = {
    aiIndex: hits[',"aiIndex":'][0] ?? null,
    evidenceStorage: hits[',"evidenceStorage":'][0] ?? null,
    results: hits[',"results":['][0] ?? null,
    visualStates: hits['],"visualStates":'].at(-1) ?? null,
    assets: hits[',"assets":'].at(-1) ?? null,
};
const boundaries = [
    ['preludeBeforeAiIndex', 0, root.aiIndex],
    ['aiIndex', root.aiIndex, root.evidenceStorage],
    ['evidenceStorage', root.evidenceStorage, root.results],
    ['results', root.results, root.visualStates],
    ['visualStates', root.visualStates, root.assets],
    ['assets', root.assets, position],
].filter(([, start, end]) => Number.isFinite(start) && Number.isFinite(end));
const testEnd = root.visualStates;
for (let index = 0; index < tests.length; index += 1) {
    tests[index].bytes = (tests[index + 1]?.offset ?? testEnd) - tests[index].offset;
}
const mib = bytes => Math.round(bytes / 1024 / 1024 * 10) / 10;
console.log(JSON.stringify({
    file,
    fileBytes: position,
    sections: boundaries.map(([name, start, end]) => ({ name, start, end, bytes: end - start, mib: mib(end - start) })),
    assetMarkers: Object.fromEntries(markers.slice(5).map(marker => [marker, hits[marker].at(-1) ?? null])),
    tests: tests.map(test => ({ ...test, mib: mib(test.bytes) })),
}, null, 2));
