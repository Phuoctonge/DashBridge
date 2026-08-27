'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'test-runner', 'test-runner-ui.js'), 'utf8');
const start = source.indexOf('async function serializeJsonInChunks(');
assert(start >= 0, 'chunked JSON serializer is missing');

const end = source.indexOf('async function exportDiagnostics(', start);
assert(end > start, 'chunked JSON serializer boundary is missing');

const context = {
    Blob,
    TextEncoder,
    setTimeout,
    console,
    DashBridgeTestReport: {
        createArtifactStreamPlan(snapshot, metadata) {
            return { prelude: { schema: 'dashbridge-e2e-diagnostics/v4', summary: { total: snapshot.results.length }, metadata } };
        },
    },
};
vm.createContext(context);
vm.runInContext(`${source.slice(start, end)}\nthis.createChunkedJsonBlob = createChunkedJsonBlob; this.serializeJsonInChunks = serializeJsonInChunks; this.serializeArtifactPlan = serializeArtifactPlan; this.serializeSpoolArtifact = serializeSpoolArtifact; this.localExportTimestamp = localExportTimestamp; this.localIsoTimestamp = localIsoTimestamp;`, context);

(async () => {
    const value = {
        russian: 'график обновлён',
        nested: [{ ok: true, missing: undefined }, null, 42],
        long: 'x'.repeat(2_200_000),
    };
    const blob = await context.createChunkedJsonBlob(value);
    const text = await blob.text();
    assert.deepStrictEqual(JSON.parse(text), JSON.parse(JSON.stringify(value)));
    assert(blob.size > 2_000_000, 'large diagnostic payload was unexpectedly truncated');
    const chunks = [];
    const progress = await context.serializeArtifactPlan({
        prelude: { schema: 'stream-test', generator: { serialization: 'test' } },
        sourceResults: [{ url: 'https://example.test', tests: [{ id: 'A' }, { id: 'B' }] }],
        compactUrlMetadata: result => ({ url: result.url }),
        compactTest: test => ({ ...test, imageRef: `img-${test.id}` }),
        assets: () => ({ images: { 'img-A': { dataUrl: 'x'.repeat(2_200_000) } } }),
    }, async chunk => { chunks.push(chunk); });
    const streamed = await new Blob(chunks).text();
    const parsed = JSON.parse(streamed);
    assert.strictEqual(parsed.results[0].tests[1].imageRef, 'img-B');
    assert.strictEqual(parsed.assets.images['img-A'].dataUrl.length, 2_200_000);
    assert(progress.characters > 2_000_000, 'streamed artifact progress must include assets');

    let writes = 0;
    const backpressure = await context.serializeJsonInChunks(
        Array.from({ length: 20 }, (_, index) => `${index}:`.padEnd(1_200_000, 'z')),
        async () => { writes += 1; await new Promise(resolve => setTimeout(resolve, 1)); }
    );
    assert(writes >= 20, 'large values must be emitted in multiple chunks');
    assert(backpressure.maxPendingChunks <= 8,
        `file serializer queued too many chunks in memory: ${backpressure.maxPendingChunks}`);
    const localDate = new Date(2026, 7, 17, 22, 19, 6, 846);
    assert.strictEqual(context.localExportTimestamp(localDate), '2026-08-17T22-19-06-846');
    assert(context.localIsoTimestamp(localDate).startsWith('2026-08-17T22:19:06.846'),
        'local ISO timestamp must use the computer clock instead of UTC components');

    const spooled = [];
    const rawEvidence = { id: 'A', diagnostic: { hugeButLossless: 'e'.repeat(1_200_000) } };
    const spoolProgress = await context.serializeSpoolArtifact({
        results: [{ diagnosticSpool: { persisted: true } }, { url: 'aborted-before-open', tests: [] }],
    }, {
        visualStates: { 'visual-one': { uses: 2 } },
        async streamUrl(index, write) {
            assert.strictEqual(index, 0);
            await write(JSON.stringify({ url: 'https://one.example', tests: [rawEvidence] }));
        },
        async streamAssets(write) {
            await write('{"policy":"all-snapshots-deduplicated/v1","images":{}}');
        },
    }, { extensionVersion: 'test' }, async chunk => { spooled.push(chunk); });
    const spooledArtifact = JSON.parse(await new Blob(spooled).text());
    assert.strictEqual(spooledArtifact.results.length, 2);
    assert.strictEqual(spooledArtifact.results[0].tests[0].diagnostic.hugeButLossless.length, 1_200_000,
        'OPFS segments must be copied to export without losing detailed evidence');
    assert.strictEqual(spooledArtifact.evidenceStorage.lossless, true);
    assert.strictEqual(spooledArtifact.evidenceStorage.mode, 'content-addressed-per-test-opfs/v2');
    assert.strictEqual(spooledArtifact.visualStates['visual-one'].uses, 2);
    assert.strictEqual(spooledArtifact.assets.policy, 'all-snapshots-deduplicated/v1');
    assert(spoolProgress.characters > 1_200_000, 'spool export progress must include disk-streamed bytes');
    console.log('PASS test runner exports large JSON in valid chunks');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
