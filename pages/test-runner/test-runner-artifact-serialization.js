// Pure streaming serializers for Test Runner diagnostic artifacts.
async function serializeJsonInChunks(value, writeChunk, onProgress = null) {
    const encoder = new TextEncoder();
    const targetCharacters = 1024 * 1024;
    let buffer = '';
    let nodes = 0;
    let characters = 0;
    let chunks = 0;
    let drainedChunks = 0;
    let maxPendingChunks = 0;
    let pendingWrite = Promise.resolve();
    const queueChunk = encoded => {
        pendingWrite = pendingWrite.then(() => writeChunk(encoded));
        chunks += 1;
        maxPendingChunks = Math.max(maxPendingChunks, chunks - drainedChunks);
    };
    const flush = () => {
        if (!buffer) return;
        const encoded = encoder.encode(buffer);
        buffer = '';
        queueChunk(encoded);
    };
    const append = text => {
        characters += text.length;
        if (text.length >= targetCharacters) {
            flush();
            let offset = 0;
            while (offset < text.length) {
                let end = Math.min(text.length, offset + targetCharacters);
                // Do not split a UTF-16 surrogate pair between TextEncoder calls.
                if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end -= 1;
                queueChunk(encoder.encode(text.slice(offset, end)));
                offset = end;
            }
            return;
        }
        if (buffer.length + text.length > targetCharacters) flush();
        buffer += text;
    };
    const checkpoint = () => {
        nodes += 1;
        // Direct file writes are asynchronous. Without chunk-level
        // backpressure a few thousand image nodes can enqueue several GB of
        // Uint8Arrays before the old 10k-node checkpoint is reached.
        if (nodes % 10_000 !== 0 && chunks - drainedChunks < 4) return null;
        return (async () => {
            flush();
            await pendingWrite;
            drainedChunks = chunks;
            onProgress?.({ nodes, characters, chunks, maxPendingChunks });
            await new Promise(resolve => setTimeout(resolve, 0));
        })();
    };
    const write = async item => {
        const pause = checkpoint();
        if (pause) await pause;
        if (item === null || item === undefined) { append('null'); return; }
        if (typeof item === 'string') { append(JSON.stringify(item)); return; }
        if (typeof item === 'number') { append(Number.isFinite(item) ? String(item) : 'null'); return; }
        if (typeof item === 'boolean') { append(item ? 'true' : 'false'); return; }
        if (Array.isArray(item)) {
            append('[');
            for (let index = 0; index < item.length; index += 1) {
                if (index) append(',');
                await write(item[index]);
            }
            append(']');
            return;
        }
        if (typeof item === 'object') {
            append('{');
            let written = 0;
            for (const [key, child] of Object.entries(item)) {
                if (child === undefined || typeof child === 'function' || typeof child === 'symbol') continue;
                if (written) append(',');
                append(JSON.stringify(key));
                append(':');
                await write(child);
                written += 1;
            }
            append('}');
            return;
        }
        append(JSON.stringify(`[${typeof item}]`));
    };
    await write(value);
    flush();
    await pendingWrite;
    drainedChunks = chunks;
    onProgress?.({ nodes, characters, chunks, maxPendingChunks, complete: true });
    return { nodes, characters, chunks, maxPendingChunks };
}

async function createChunkedJsonBlob(value, onProgress = null) {
    const parts = [];
    await serializeJsonInChunks(value, chunk => { parts.push(chunk); }, onProgress);
    return new Blob(parts, { type: 'application/json' });
}

// Results and content-addressed assets are already in OPFS. Copy their JSON
// bytes straight to the destination without rebuilding a multi-GiB object.
async function serializeSpoolArtifact(snapshot, spool, metadata, writeChunk, onProgress = null) {
    const plan = DashBridgeTestReport.createArtifactStreamPlan(snapshot, metadata);
    const prelude = {
        ...plan.prelude,
        evidenceStorage: {
            mode: 'content-addressed-per-test-opfs/v2',
            reason: 'Compacted tests and unique assets are streamed from OPFS so dashboards do not accumulate in the renderer heap',
            lossless: true,
        },
    };
    const encoder = new TextEncoder();
    const totals = { nodes: 0, characters: 0, chunks: 0 };
    const report = (complete = false) => onProgress?.({ ...totals, complete });
    const writeText = async text => {
        await writeChunk(encoder.encode(text));
        totals.characters += text.length;
        totals.chunks += 1;
    };
    const writeValue = async value => {
        const result = await serializeJsonInChunks(value, writeChunk);
        totals.nodes += result.nodes;
        totals.characters += result.characters;
        totals.chunks += result.chunks;
    };
    await writeText('{');
    let rootFields = 0;
    for (const [key, value] of Object.entries(prelude)) {
        if (rootFields++) await writeText(',');
        await writeValue(key);
        await writeText(':');
        await writeValue(value);
    }
    if (rootFields++) await writeText(',');
    await writeValue('results');
    await writeText(':[');
    for (let index = 0; index < snapshot.results.length; index += 1) {
        if (index) await writeText(',');
        const result = snapshot.results[index];
        if (result?.diagnosticSpool?.persisted) {
            await spool.streamUrl(index, async chunk => {
                if (typeof chunk === 'string') await writeText(chunk);
                else {
                    await writeChunk(chunk);
                    totals.characters += chunk.byteLength;
                    totals.chunks += 1;
                }
            });
        } else {
            // Abort-before-open results contain only tiny NOT RUN records and
            // are safe to serialize directly.
            await writeValue(result);
        }
        report();
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    await writeText('],"visualStates":');
    await writeValue(spool.visualStates);
    await writeText(',"assets":');
    await spool.streamAssets(async chunk => {
        if (typeof chunk === 'string') await writeText(chunk);
        else {
            await writeChunk(chunk);
            totals.characters += chunk.byteLength;
            totals.chunks += 1;
        }
    });
    await writeText('}');
    report(true);
    return totals;
}

function localExportTimestamp(date = new Date()) {
    const pad = (value, length = 2) => String(value).padStart(length, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
        + `T${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}-${pad(date.getMilliseconds(), 3)}`;
}

function localIsoTimestamp(date = new Date()) {
    const pad = (value, length = 2) => String(value).padStart(length, '0');
    const offsetMinutes = -date.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const absoluteOffset = Math.abs(offsetMinutes);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
        + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
        + `${sign}${pad(Math.floor(absoluteOffset / 60))}:${pad(absoluteOffset % 60)}`;
}

