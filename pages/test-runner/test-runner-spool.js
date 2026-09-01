// OPFS-backed storage for bounded Test Runner diagnostics.
class DiagnosticSpool {
    constructor() {
        this.root = null;
        this.baseDirectory = null;
        this.directory = null;
        this.entries = [];
        this.assets = new Map();
        this.assetsByCategory = {
            images: new Map(), domSnapshots: new Map(),
            diagnosticEvents: new Map(), performanceResources: new Map(),
        };
        this.visualStates = {};
        this.retainedImageBytes = 0;
        this.spoolBytes = 0;
        this.storageEstimate = null;
    }

    async begin(runId) {
        await this.clear();
        if (typeof navigator.storage?.getDirectory !== 'function') {
            throw new Error('Chrome не предоставляет OPFS — безопасный запуск нескольких дашбордов невозможен');
        }
        this.root = await navigator.storage.getDirectory();
        this.baseDirectory = await this.root.getDirectoryHandle('dashbridge-e2e-spool', { create: true });
        // OPFS survives closing the runner page. Remove stale *DashBridge-only*
        // sessions here so multi-gigabyte evidence from an interrupted old run
        // cannot silently consume the browser quota forever.
        for await (const [name] of this.baseDirectory.entries()) {
            await this.baseDirectory.removeEntry(name, { recursive: true });
        }
        const name = `dashbridge-e2e-run-${String(runId || Date.now()).replace(/[^a-z0-9_-]/gi, '-')}`;
        this.directory = await this.baseDirectory.getDirectoryHandle(name, { create: true });
        this.entries = [];
        this.assets.clear();
        Object.values(this.assetsByCategory).forEach(store => store.clear());
        this.visualStates = {};
        this.retainedImageBytes = 0;
        this.spoolBytes = 0;
        this.storageEstimate = typeof navigator.storage?.estimate === 'function'
            ? await navigator.storage.estimate().catch(() => null) : null;
    }

    static async clearStaleSessions() {
        if (typeof navigator.storage?.getDirectory !== 'function') return;
        const root = await navigator.storage.getDirectory();
        const base = await root.getDirectoryHandle('dashbridge-e2e-spool', { create: true });
        for await (const [name] of base.entries()) {
            await base.removeEntry(name, { recursive: true });
        }
    }

    async clear() {
        const root = this.root;
        const baseDirectory = this.baseDirectory;
        const directory = this.directory;
        this.root = null;
        this.baseDirectory = null;
        this.directory = null;
        this.entries = [];
        this.assets.clear();
        Object.values(this.assetsByCategory).forEach(store => store.clear());
        this.visualStates = {};
        this.retainedImageBytes = 0;
        this.spoolBytes = 0;
        this.storageEstimate = null;
        if (root && baseDirectory && directory) {
            await baseDirectory.removeEntry(directory.name, { recursive: true }).catch(() => {});
        }
    }

    async writeJson(name, value) {
        const handle = await this.directory.getFileHandle(name, { create: true });
        const previousSize = await handle.getFile().then(file => file.size).catch(() => 0);
        const writable = await handle.createWritable();
        try {
            await serializeJsonInChunks(value, chunk => writable.write(chunk));
            await writable.close();
            const nextSize = await handle.getFile().then(file => file.size).catch(() => previousSize);
            this.spoolBytes += Math.max(0, nextSize - previousSize);
        } catch (error) {
            await writable.abort?.(error).catch(() => {});
            throw error;
        }
    }

    static testSummary(test, ref) {
        // Keep only scalar/UI fields. In particular do not shallow-copy any
        // diagnostic sub-object: that would keep its entire object graph live.
        return {
            id: test.id, category: test.category, name: test.name,
            feature: test.feature || null, pass: !!test.pass, skip: !!test.skip,
            aborted: !!test.aborted, details: test.details || '',
            durationMs: Number(test.durationMs) || 0,
            timedOut: !!test.timedOut, environmentUnsafe: !!test.environmentUnsafe,
            error: test.error || null,
            outcome: test.outcome || null,
            reasonCode: test.reasonCode || null,
            shortReason: test.shortReason || null,
            visualAudit: test.visualAudit || null,
            analysisUnit: test.analysisUnit || null,
            diagnosticRef: ref,
        };
    }

    static networkPayloadRecord(url, diagnostic) {
        const archive = diagnostic?.networkPayloadArchive || {};
        const requests = Object.values(archive.requests || {});
        const responses = Object.values(archive.responses || {});
        const observations = responses.flatMap(response => response.observations || []);
        const payloads = [
            ...requests.map(request => request.body),
            ...observations.map(observation => observation.payload),
        ].filter(Boolean);
        return {
            url, schema: archive.schema || null,
            requests: requests.length, responses: responses.length, observations: observations.length,
            payloadBytes: payloads.reduce((sum, payload) => sum + (Number(payload.textBytes) || 0), 0),
            payloadErrors: payloads.filter(payload => payload.error).length,
            requestIds: requests.map(request => request.requestId).filter(Boolean),
        };
    }

    mergeVisualStates(states = {}) {
        for (const [ref, incoming] of Object.entries(states)) {
            const current = this.visualStates[ref];
            if (!current) {
                this.visualStates[ref] = incoming;
                continue;
            }
            current.uses = (current.uses || 0) + (incoming.uses || 0);
            for (const key of ['captureModes', 'reasons']) {
                for (const value of incoming[key] || []) {
                    if (!current[key].includes(value)) current[key].push(value);
                }
            }
            current.evidence.panelImageRef ||= incoming.evidence?.panelImageRef || null;
            current.evidence.viewportImageRef ||= incoming.evidence?.viewportImageRef || null;
            for (const imageRef of incoming.evidence?.canvasImageRefs || []) {
                if (!current.evidence.canvasImageRefs.includes(imageRef)) current.evidence.canvasImageRefs.push(imageRef);
            }
        }
    }

    async persistAssets(assets = {}) {
        const categories = ['images', 'domSnapshots', 'diagnosticEvents', 'performanceResources'];
        for (const category of categories) {
            for (const [ref, value] of Object.entries(assets[category] || {})) {
                if (this.assets.has(ref)) continue;
                const file = `asset-${category}-${ref}.json`;
                await this.writeJson(file, value);
                const record = { category, file };
                this.assets.set(ref, record);
                this.assetsByCategory[category].set(ref, record);
                if (category === 'images') this.retainedImageBytes += Number(value.bytes) || 0;
            }
        }
    }

    async persistTest(test, urlIndex, testIndex, url = '') {
        if (!this.directory) throw new Error('Дисковое хранилище диагностики не инициализировано');
        const artifact = DashBridgeTestReport.createTestArtifact(test, { url });
        await this.persistAssets(artifact.assets);
        this.mergeVisualStates(artifact.visualStates);
        const file = `url-${String(urlIndex).padStart(4, '0')}-test-${String(testIndex).padStart(4, '0')}.json`;
        await this.writeJson(file, artifact.value);
        const persistedBytes = await this.directory.getFileHandle(file)
            .then(handle => handle.getFile()).then(value => value.size);
        const entry = this.entries[urlIndex] || (this.entries[urlIndex] = { metadataFile: null, testFiles: [] });
        entry.testFiles[testIndex] = file;
        return DiagnosticSpool.testSummary({ ...artifact.value, analysisUnit: artifact.analysisUnit },
            { urlIndex, testIndex, file, bytes: persistedBytes });
    }

    async persistUrl(urlResult, urlIndex) {
        if (!this.directory) throw new Error('Дисковое хранилище диагностики не инициализировано');
        const prefix = `url-${String(urlIndex).padStart(4, '0')}`;
        const { tests = [], ...metadata } = urlResult;
        const metadataFile = `${prefix}-metadata.json`;
        const metadataArtifact = DashBridgeTestReport.createUrlMetadataArtifact(metadata);
        await this.persistAssets(metadataArtifact.assets);
        this.mergeVisualStates(metadataArtifact.visualStates);
        await this.writeJson(metadataFile, metadataArtifact.value);
        const entry = this.entries[urlIndex] || (this.entries[urlIndex] = { metadataFile: null, testFiles: [] });
        entry.metadataFile = metadataFile;
        const summaries = [];
        for (let index = 0; index < tests.length; index += 1) {
            const existingFile = entry.testFiles[index];
            if (tests[index]?.diagnosticRef && existingFile) summaries.push(tests[index]);
            else summaries.push(await this.persistTest(tests[index], urlIndex, index, metadata.url || ''));
            // Yield between tests so Chromium can collect the just-serialized
            // temporary strings before the next large diagnostic is handled.
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        // The compact URL metadata is on disk. Keep only non-diagnostic fields
        // and a tiny aggregate used by the global analysis in renderer memory.
        const { diagnostic, ...uiMetadata } = metadata;
        return {
            ...uiMetadata,
            tests: summaries,
            analysisNetworkPayloadRecord: DiagnosticSpool.networkPayloadRecord(metadata.url, diagnostic),
            diagnosticSpool: { urlIndex, persisted: true },
        };
    }

    async readCompactedTest(ref) {
        if (!ref?.file || !this.directory) return null;
        const handle = await this.directory.getFileHandle(ref.file);
        return JSON.parse(await (await handle.getFile()).text());
    }

    async readTest(ref) {
        const test = await this.readCompactedTest(ref);
        if (!test) return null;
        return this.hydrateValue(test, new Map());
    }

    async readAsset(ref) {
        const record = this.assets.get(ref);
        if (!record) return null;
        const handle = await this.directory.getFileHandle(record.file);
        return JSON.parse(await (await handle.getFile()).text());
    }

    async hydrateValue(value, cache = new Map()) {
        if (value === null || value === undefined || typeof value !== 'object') return value;
        if (Array.isArray(value)) return Promise.all(value.map(item => this.hydrateValue(item, cache)));
        if (value.assetRef && Object.keys(value).length === 1) {
            if (!cache.has(value.assetRef)) cache.set(value.assetRef, this.readAsset(value.assetRef));
            const asset = await cache.get(value.assetRef);
            return asset?.value ?? value;
        }
        const output = {};
        for (const [key, child] of Object.entries(value)) output[key] = await this.hydrateValue(child, cache);
        if (value.imageRef && !output.dataUrl) {
            if (!cache.has(value.imageRef)) cache.set(value.imageRef, this.readAsset(value.imageRef));
            const image = await cache.get(value.imageRef);
            if (image?.dataUrl) output.dataUrl = image.dataUrl;
        }
        if (value.outerHTMLRef && !output.outerHTML) {
            if (!cache.has(value.outerHTMLRef)) cache.set(value.outerHTMLRef, this.readAsset(value.outerHTMLRef));
            const dom = await cache.get(value.outerHTMLRef);
            if (typeof dom?.value === 'string') output.outerHTML = dom.value;
        }
        return output;
    }

    async streamFile(name, writeChunk, start = 0, end = undefined) {
        const handle = await this.directory.getFileHandle(name);
        const file = await handle.getFile();
        const reader = file.slice(start, end).stream().getReader();
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                await writeChunk(value);
            }
        } finally {
            reader.releaseLock();
        }
    }

    async streamUrl(urlIndex, writeChunk) {
        const entry = this.entries[urlIndex];
        if (!entry) throw new Error(`Нет дискового сегмента для URL #${urlIndex + 1}`);
        const metadata = await (await this.directory.getFileHandle(entry.metadataFile)).getFile();
        if (metadata.size < 2) throw new Error(`Повреждён метаданный сегмент URL #${urlIndex + 1}`);
        await writeChunk('{');
        await this.streamFile(entry.metadataFile, writeChunk, 1, metadata.size - 1);
        await writeChunk(',"tests":[');
        for (let index = 0; index < entry.testFiles.length; index += 1) {
            if (index) await writeChunk(',');
            await this.streamFile(entry.testFiles[index], writeChunk);
        }
        await writeChunk(']}');
    }

    async streamAssets(writeChunk) {
        const counts = Object.fromEntries(Object.entries(this.assetsByCategory)
            .map(([category, store]) => [category, store.size]));
        await writeChunk('{"policy":"all-snapshots-deduplicated/v1"');
        await writeChunk(`,"retainedImageBytes":${this.retainedImageBytes}`);
        await writeChunk(`,"retainedImages":${counts.images},"omittedImages":0`);
        for (const category of ['images', 'domSnapshots', 'diagnosticEvents', 'performanceResources']) {
            const label = category === 'domSnapshots' ? 'retainedDomSnapshots'
                : category === 'diagnosticEvents' ? 'retainedDiagnosticEvents'
                    : category === 'performanceResources' ? 'retainedPerformanceResources' : null;
            if (label) await writeChunk(`,"${label}":${counts[category]}`);
            await writeChunk(`,"${category}":{`);
            let index = 0;
            for (const [ref, record] of this.assetsByCategory[category]) {
                if (index++) await writeChunk(',');
                await writeChunk(`${JSON.stringify(ref)}:`);
                await this.streamFile(record.file, writeChunk);
            }
            await writeChunk('}');
        }
        await writeChunk('}');
    }
}

// --- Утилиты ---

