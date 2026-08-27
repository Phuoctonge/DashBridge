'use strict';

// Reads only the artifact header. The multi-gigabyte results/assets body is
// intentionally never materialised in memory.
const fs = require('fs');

const file = process.argv[2];
if (!file) {
    console.error('Usage: node test/analyze_e2e_diagnostics_summary.js <report.json>');
    process.exit(2);
}

const fd = fs.openSync(file, 'r');
const buffer = Buffer.alloc(64 * 1024 * 1024);
const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
fs.closeSync(fd);
const text = buffer.subarray(0, bytes).toString('utf8');

const readObject = key => {
    const marker = `"${key}":`;
    const markerAt = text.indexOf(marker);
    if (markerAt < 0) return null;
    const start = text.indexOf('{', markerAt + marker.length);
    if (start < 0) return null;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
        const char = text[index];
        if (inString) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') inString = false;
            continue;
        }
        if (char === '"') inString = true;
        else if (char === '{' || char === '[') depth += 1;
        else if (char === '}' || char === ']') {
            depth -= 1;
            if (depth === 0) return JSON.parse(text.slice(start, index + 1));
        }
    }
    return null;
};

const summary = readObject('summary');
const analysis = readObject('analysis');
const withoutRecords = value => value ? Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== 'records')
) : null;
console.log(JSON.stringify({
    file,
    fileBytes: fs.statSync(file).size,
    headerBytesRead: bytes,
    summary,
    analysis: analysis ? {
        verdict: analysis.verdict,
        primaryFailure: analysis.primaryFailure,
        failureClusters: analysis.failureClusters,
        skipClusters: analysis.skipClusters,
        notRunClusters: analysis.notRunClusters,
        suspiciousPasses: analysis.suspiciousPasses,
        visualEvidenceCoverage: analysis.visualEvidenceCoverage,
        settlementHealth: withoutRecords(analysis.settlementHealth),
        persistenceHealth: withoutRecords(analysis.persistenceHealth),
        commandQueueHealth: withoutRecords(analysis.commandQueueHealth),
        actionTraceHealth: withoutRecords(analysis.actionTraceHealth),
        networkPayloadHealth: withoutRecords(analysis.networkPayloadHealth),
        diagnosticDepthHealth: withoutRecords(analysis.diagnosticDepthHealth),
        recommendations: analysis.recommendations,
    } : null,
}, null, 2));
