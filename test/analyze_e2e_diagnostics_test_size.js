'use strict';

// Materialises one explicitly bounded test segment, then measures its JSON
// subtrees without ever loading the rest of the multi-gigabyte report.
// Run Node with a larger heap for segments near 500 MiB.
const fs = require('fs');

const [file, offsetText, bytesText, reportDepthText, selectedPath = ''] = process.argv.slice(2);
const offset = Number(offsetText);
const bytes = Number(bytesText);
const reportDepth = Number.isInteger(Number(reportDepthText)) ? Number(reportDepthText) : 3;
if (!file || !Number.isSafeInteger(offset) || !Number.isSafeInteger(bytes) || bytes <= 0) {
    console.error('Usage: node test/analyze_e2e_diagnostics_test_size.js <report.json> <offset> <bytes>');
    process.exit(2);
}

const fd = fs.openSync(file, 'r');
const buffer = Buffer.allocUnsafe(bytes);
let read = 0;
while (read < bytes) {
    const current = fs.readSync(fd, buffer, read, bytes - read, offset + read);
    if (!current) break;
    read += current;
}
fs.closeSync(fd);
let source = buffer.subarray(0, read).toString('utf8');
source = source.replace(/,\s*$/, '');
const rootValue = JSON.parse(source);
const value = selectedPath ? selectedPath.split('.').filter(Boolean)
    .reduce((current, key) => current?.[key], rootValue) : rootValue;
if (value === undefined) throw new Error(`Path not found: ${selectedPath}`);

const utf8 = text => Buffer.byteLength(text, 'utf8');
const topLimit = 12;
function retainTop(top, item) {
    top.push(item);
    top.sort((left, right) => right.bytes - left.bytes);
    if (top.length > topLimit) top.pop();
}

function measure(current, depth = 0) {
    if (current === null) return { bytes: 4, summary: null };
    if (typeof current !== 'object') {
        const serialized = JSON.stringify(current);
        return { bytes: utf8(serialized === undefined ? 'null' : serialized), summary: null };
    }
    const array = Array.isArray(current);
    const entries = array ? current.map((item, index) => [String(index), item]) : Object.entries(current);
    let total = 2 + Math.max(0, entries.length - 1);
    const top = [];
    for (const [key, child] of entries) {
        const measured = measure(child, depth + 1);
        const keyBytes = array ? 0 : utf8(JSON.stringify(key)) + 1;
        const contribution = keyBytes + measured.bytes;
        total += contribution;
        if (depth < reportDepth) {
            retainTop(top, {
                key,
                bytes: contribution,
                mib: Math.round(contribution / 1024 / 1024 * 10) / 10,
                children: measured.summary,
            });
        }
    }
    return { bytes: total, summary: depth < reportDepth ? top : null };
}

const measured = measure(value);
console.log(JSON.stringify({
    id: rootValue.id || null,
    selectedPath: selectedPath || null,
    segmentBytes: bytes,
    parsedBytes: measured.bytes,
    mib: Math.round(measured.bytes / 1024 / 1024 * 10) / 10,
    largestSubtrees: measured.summary,
}, null, 2));
