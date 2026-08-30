'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const JSZip = require('../vendor/jszip.min.js');

const root = path.join(__dirname, '..');
const context = vm.createContext({ TextEncoder, URL, btoa });
context.globalThis = context;
vm.runInContext(fs.readFileSync(path.join(root, 'js', 'shared', 'dashflow-schema.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(root, 'pages', 'recorder', 'recorder-dashflow-io.js'), 'utf8'), context);

const sha256 = async bytes => {
    const digest = await crypto.webcrypto.subtle.digest('SHA-256', bytes);
    return Buffer.from(digest).toString('hex');
};
const baseLimits = Object.freeze({
    fileBytes: 10 * 1024 * 1024,
    workingSetBytes: 10 * 1024 * 1024,
    manifestBytes: 1024 * 1024,
    flowBytes: 1024 * 1024,
    networkBytes: 1024 * 1024,
    streamsBytes: 1024 * 1024,
    requestBodyBytes: 1024,
    totalRequestBodyBytes: 4096,
    bodyBytes: 1024,
    totalBodyBytes: 4096,
    streamPayloadBytes: 4096
});
const createIo = overrides => context.DashBridgeDashflowIo.create({
    JSZip,
    schema: context.DashBridgeFlowSchema,
    sha256,
    limits: { ...baseLimits, ...overrides }
});
const jsonEntries = ({ network, streams } = {}) => ({
    'manifest.json': {
        format: 'dashbridge-flow', version: 2, title: 'Fixture',
        flow: 'flow.json', network: 'network.json', baseline: 'traffic.har', streams: 'streams.json'
    },
    'flow.json': { title: 'Fixture', steps: [{ type: 'navigate', url: 'https://example.test/' }] },
    'network.json': network || { version: 2, requests: [], pageEvents: [] },
    'streams.json': streams || { version: 1, events: [] },
    'traffic.har': { log: { version: '1.2', entries: [] } }
});
async function archiveFile(entries, binaryEntries = {}) {
    const zip = new JSZip();
    for (const [name, value] of Object.entries(entries)) zip.file(name, JSON.stringify(value));
    for (const [name, value] of Object.entries(binaryEntries)) zip.file(name, value);
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    return {
        size: bytes.byteLength,
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    };
}

(async () => {
    assert.throws(
        () => context.DashBridgeDashflowIo.create({}),
        /requires JSZip, schema and SHA-256 adapters/,
        'the archive boundary must reject incomplete integration'
    );

    const body = new Uint8Array([0, 1, 2, 250, 255]);
    const digest = await sha256(body);
    const validFile = await archiveFile(jsonEntries({
        network: {
            version: 2,
            pageEvents: [{ type: 'load' }],
            requests: [{
                requestId: 'request-1', method: 'POST', url: 'https://example.test/api',
                postData: 'payload', bodyPath: 'bodies/000001_request-1.bin', bodySha256: digest
            }]
        },
        streams: { version: 1, events: [{ data: 'stream-data' }] }
    }), { 'bodies/000001_request-1.bin': body });
    const imported = await createIo().read(validFile);
    const importedRequest = imported.requests.get('request-1');
    assert.strictEqual(imported.flow.steps.length, 1);
    assert.strictEqual(imported.totalRequestBodyBytes, 7);
    assert.strictEqual(imported.totalBodyBytes, body.byteLength);
    assert.strictEqual(imported.streamPayloadBytes, 11);
    assert.strictEqual(importedRequest.responseBody, Buffer.from(body).toString('base64'));
    assert.strictEqual(importedRequest.bodySha256, digest);

    const missingEntryFile = await archiveFile((() => {
        const entries = jsonEntries();
        delete entries['streams.json'];
        return entries;
    })());
    await assert.rejects(createIo().read(missingEntryFile), /обязательные файлы DashFlow v2/);

    await assert.rejects(createIo({ flowBytes: 16 }).read(validFile), /flow\.json превышает/,
        'a declared oversized ZIP entry must fail before JSON parsing');
    await assert.rejects(createIo({ workingSetBytes: 1 }).read(validFile), /безопасный общий размер/,
        'the aggregate decompressed working set must remain bounded');

    const sentinel = { title: 'existing session', requests: 3 };
    const corruptFile = await archiveFile(jsonEntries({
        network: {
            version: 2,
            requests: [{
                requestId: 'bad', method: 'GET', url: 'https://example.test/',
                bodyPath: 'bodies/bad.bin', bodySha256: '0'.repeat(64)
            }]
        }
    }), { 'bodies/bad.bin': body });
    await assert.rejects(createIo().read(corruptFile), /Нарушена целостность/);
    assert.deepStrictEqual(sentinel, { title: 'existing session', requests: 3 },
        'a rejected archive must not expose a partial result for the controller to commit');

    await assert.rejects(createIo().read({ size: 4, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer }),
        /zip|signature|archive|corrupt/i, 'invalid ZIP data must be rejected');

    console.log('PASS DashFlow I/O validates archives before exposing an atomic import result');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
