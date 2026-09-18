(function initConfluenceReportZip(root) {
    'use strict';
    const MAX_BYTES = 300 * 1024 * 1024; const MAX_ENTRIES = 2000; const MAX_CAPTURES = 1000;
    const safe = value => { const path = String(value || '').replace(/\\/g, '/'); if (!path || path.startsWith('/') || path.split('/').includes('..')) throw new Error(`Unsafe archive path: ${path}`); return path; };
    async function digest(blob) { if (!root.crypto?.subtle) return null; const bytes = await blob.arrayBuffer(); const hash = await root.crypto.subtle.digest('SHA-256', bytes); return [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join(''); }
    function create({ JSZip, schema }) {
        if (!JSZip?.loadAsync || !schema?.normalizeManifest) throw new Error('ZIP dependencies are required');
        async function load(file, signal) {
            if (!file || Number(file.size) > MAX_BYTES) throw new Error('Archive exceeds size limit');
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
            const archive = await JSZip.loadAsync(file); const entries = Object.values(archive.files || {});
            if (entries.length > MAX_ENTRIES) throw new Error('Archive has too many entries');
            const manifestEntry = archive.files['manifest.json']; if (!manifestEntry || manifestEntry.dir) throw new Error('manifest.json is required');
            const manifest = schema.normalizeManifest(JSON.parse(await manifestEntry.async('text'))); if (manifest.captures.length > MAX_CAPTURES) throw new Error('Too many captures');
            const sources = new Map(); let total = 0;
            for (const capture of manifest.captures) { if (signal?.aborted) throw new DOMException('Aborted', 'AbortError'); const entry = archive.files[safe(capture.file)]; if (!entry || entry.dir) throw new Error(`Capture is missing: ${capture.file}`); const blob = await entry.async('blob'); total += blob.size; if (total > MAX_BYTES) throw new Error('Unpacked archive exceeds size limit'); const actual = await digest(blob); if (capture.sha256 && actual !== capture.sha256) throw new Error(`Hash mismatch: ${capture.file}`); sources.set(capture.file, { path: capture.file, blob, bytes: blob.size, sha256: actual }); }
            const fingerprint = `${file.name || 'archive'}:${file.size}:${manifest.generatedAt || ''}:${manifest.captures.length}`;
            return Object.freeze({ fingerprint, manifest, sources });
        }
        return Object.freeze({ load });
    }
    root.DashBridgeConfluenceReportZip = Object.freeze({ create });
})(globalThis);
