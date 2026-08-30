(function initDashBridgeDashflowIo(global) {
    'use strict';

    const create = ({
        JSZip,
        schema,
        sha256,
        limits,
        TextEncoderRef = TextEncoder,
        btoaFn = btoa,
        outputType = 'blob'
    } = {}) => {
        if (typeof JSZip !== 'function' || !schema || typeof sha256 !== 'function') {
            throw new TypeError('DashFlow I/O requires JSZip, schema and SHA-256 adapters');
        }

        const requiredLimits = [
            'fileBytes', 'workingSetBytes', 'manifestBytes', 'flowBytes', 'networkBytes',
            'streamsBytes', 'requestBodyBytes', 'totalRequestBodyBytes', 'bodyBytes',
            'totalBodyBytes', 'streamPayloadBytes'
        ];
        if (!limits || requiredLimits.some(name => !Number.isFinite(limits[name]) || limits[name] < 0)) {
            throw new TypeError('DashFlow I/O requires finite archive limits');
        }

        const bytesToBase64 = bytes => {
            let binary = '';
            const chunkSize = 32 * 1024;
            for (let offset = 0; offset < bytes.length; offset += chunkSize) {
                binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize)));
            }
            return btoaFn(binary);
        };
        const entryUncompressedSize = entry => {
            const size = Number(entry?._data?.uncompressedSize);
            return Number.isFinite(size) && size >= 0 ? size : null;
        };
        const assertEntrySize = (entry, label, maxBytes) => {
            if (!entry) throw new TypeError(`В архиве отсутствует ${label}`);
            const size = entryUncompressedSize(entry);
            if (size !== null && size > maxBytes) {
                throw new RangeError(`${label} превышает безопасный распакованный размер`);
            }
            return size;
        };
        const assertWorkingSet = entries => {
            const uniqueEntries = new Set();
            let total = 0;
            for (const entry of entries) {
                if (!entry || uniqueEntries.has(entry)) continue;
                uniqueEntries.add(entry);
                const size = entryUncompressedSize(entry);
                if (size !== null) total += size;
                if (total > limits.workingSetBytes) {
                    throw new RangeError('Распакованные данные .dashflow превышают безопасный общий размер');
                }
            }
            return total;
        };

        const write = async ({ manifest, flow, network, har, streams, bodies = [], responseBodyBytes = 0 } = {}) => {
            if (!manifest || !flow || !network || !har || !streams || !Array.isArray(bodies)) {
                throw new TypeError('DashFlow export requires manifest, flow, network, HAR, streams and bodies');
            }
            const serialized = {
                manifest: JSON.stringify(manifest, null, 2),
                flow: JSON.stringify(flow, null, 2),
                network: JSON.stringify(network, null, 2),
                har: JSON.stringify(har, null, 2),
                streams: JSON.stringify(streams, null, 2)
            };
            const serializedUpperBound = Object.values(serialized)
                .reduce((total, value) => total + value.length * 2, 0);
            if (Math.max(0, Number(responseBodyBytes) || 0) + serializedUpperBound > limits.workingSetBytes) {
                throw new RangeError('Метаданные записи превышают безопасный размер одного .dashflow');
            }

            const zip = new JSZip();
            const bodyPaths = new Set();
            let bodyBytes = 0;
            for (const body of bodies) {
                if (!body || !/^bodies\/[a-zA-Z0-9_.-]+\.bin$/.test(body.path) || bodyPaths.has(body.path)) {
                    throw new TypeError('Некорректный или повторяющийся путь тела ответа');
                }
                const byteLength = Number(body.bytes?.byteLength);
                if (!Number.isFinite(byteLength) || byteLength < 0 || byteLength > limits.bodyBytes
                    || bodyBytes + byteLength > limits.totalBodyBytes) {
                    throw new RangeError('Тела ответов превышают лимиты DashFlow');
                }
                bodyPaths.add(body.path);
                bodyBytes += byteLength;
                zip.file(body.path, body.bytes);
            }
            zip.file('manifest.json', serialized.manifest);
            zip.file('flow.json', serialized.flow);
            zip.file('network.json', serialized.network);
            zip.file('traffic.har', serialized.har);
            zip.file('streams.json', serialized.streams);
            return zip.generateAsync({
                type: outputType,
                mimeType: 'application/octet-stream',
                compression: 'DEFLATE',
                compressionOptions: { level: 6 }
            });
        };

        const read = async file => {
            if (!file || file.size > limits.fileBytes) throw new RangeError('Файл превышает лимит 512 МиБ');
            const zip = await JSZip.loadAsync(await file.arrayBuffer());
            const manifestFile = zip.file('manifest.json');
            const flowFile = zip.file('flow.json');
            const networkFile = zip.file('network.json');
            const streamsFile = zip.file('streams.json');
            const harFile = zip.file('traffic.har');
            if (!manifestFile || !flowFile || !networkFile || !harFile || !streamsFile) {
                throw new TypeError('В архиве отсутствуют обязательные файлы DashFlow v2');
            }
            assertEntrySize(manifestFile, 'manifest.json', limits.manifestBytes);
            assertEntrySize(flowFile, 'flow.json', limits.flowBytes);
            assertEntrySize(networkFile, 'network.json', limits.networkBytes);
            assertEntrySize(streamsFile, 'streams.json', limits.streamsBytes);
            assertEntrySize(harFile, 'traffic.har', limits.networkBytes);
            const archiveEntries = [manifestFile, flowFile, networkFile, streamsFile, harFile];
            assertWorkingSet(archiveEntries);

            const manifest = schema.validateManifest(JSON.parse(await manifestFile.async('string')));
            const flow = schema.validateFlow(JSON.parse(await flowFile.async('string')));
            const network = schema.validateNetwork(JSON.parse(await networkFile.async('string')));
            const streams = schema.validateStreams(JSON.parse(await streamsFile.async('string')));
            const derivedHar = JSON.parse(await harFile.async('string'));
            if (!derivedHar?.log || derivedHar.log.version !== '1.2' || !Array.isArray(derivedHar.log.entries)) {
                throw new TypeError('Некорректный traffic.har');
            }

            const requests = new Map();
            network.requests.forEach((request, index) => {
                const key = String(request.requestId || `import-${index}`);
                if (requests.has(key)) throw new TypeError(`Повторяющийся requestId: ${key}`);
                requests.set(key, { ...request, requestId: key });
            });

            let totalRequestBodyBytes = 0;
            for (const request of requests.values()) {
                if (request.postData === undefined) continue;
                const bytes = new TextEncoderRef().encode(String(request.postData)).byteLength;
                if (bytes > limits.requestBodyBytes
                    || totalRequestBodyBytes + bytes > limits.totalRequestBodyBytes) {
                    throw new RangeError('Тела запросов превышают лимиты DashFlow');
                }
                totalRequestBodyBytes += bytes;
            }

            const bodyEntries = new Map();
            for (const request of requests.values()) {
                if (!request.bodyPath) continue;
                if (!/^bodies\/[a-zA-Z0-9_.-]+\.bin$/.test(request.bodyPath)) {
                    throw new TypeError('Некорректный путь тела ответа');
                }
                const bodyFile = zip.file(request.bodyPath);
                if (!bodyFile) throw new TypeError(`В архиве отсутствует ${request.bodyPath}`);
                assertEntrySize(bodyFile, request.bodyPath, limits.bodyBytes);
                bodyEntries.set(request.bodyPath, bodyFile);
            }
            archiveEntries.push(...bodyEntries.values());
            assertWorkingSet(archiveEntries);

            let totalBodyBytes = 0;
            for (const request of requests.values()) {
                if (!request.bodyPath) continue;
                const bytes = await bodyEntries.get(request.bodyPath).async('uint8array');
                if (bytes.byteLength > limits.bodyBytes || totalBodyBytes + bytes.byteLength > limits.totalBodyBytes) {
                    throw new RangeError('Тела ответов превышают лимиты DashFlow');
                }
                const digest = await sha256(bytes);
                if (request.bodySha256 && request.bodySha256 !== digest) {
                    throw new TypeError(`Нарушена целостность ${request.bodyPath}`);
                }
                request.responseBody = bytesToBase64(bytes);
                request.bodyBase64 = true;
                request.bodyBytes = bytes.byteLength;
                request.bodySha256 = digest;
                totalBodyBytes += bytes.byteLength;
            }

            let streamPayloadBytes = 0;
            for (const event of streams.events) {
                const payload = event?.response?.payloadData ?? event?.data ?? '';
                streamPayloadBytes += new TextEncoderRef().encode(String(payload)).byteLength;
                if (streamPayloadBytes > limits.streamPayloadBytes) {
                    throw new RangeError('Потоковые данные превышают лимиты DashFlow');
                }
            }

            return Object.freeze({
                manifest,
                flow,
                network,
                streams,
                requests,
                totalRequestBodyBytes,
                totalBodyBytes,
                streamPayloadBytes
            });
        };

        return Object.freeze({ write, read });
    };

    global.DashBridgeDashflowIo = Object.freeze({ create });
})(globalThis);
