(function initConfluenceReportApply(root) {
    'use strict';
    const escapeXml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
    function create({ storage = root.DashBridgeConfluenceReportStorage, uploadAttachment, updatePage, verifyPage } = {}) {
        if (!storage?.transform || typeof uploadAttachment !== 'function' || typeof updatePage !== 'function' || typeof verifyPage !== 'function') throw new Error('Confluence apply dependencies are unavailable');
        async function apply({ page, replacements = [], additions = [], sources = new Map(), uploaded = new Map(), signal, onProgress = () => {} } = {}) {
            if (!page?.pageIdentity?.pageId || !Number.isInteger(page.pageIdentity.version)) throw new Error('Page identity/version is required');
            const attachmentNames = new Set((page.attachments || []).map(item => item.title)); const attachmentResults = [];
            const ensureUpload = async filename => { if (uploaded.has(filename)) return uploaded.get(filename); const source = sources.get(filename); if (!source?.blob) throw new Error(`ZIP source not found: ${filename}`); const existing = (page.attachments || []).find(item => item.title === filename) || null; onProgress({ stage: 'upload', filename }); const result = await uploadAttachment({ filename, blob: source.blob, existing, signal }); uploaded.set(filename, result); attachmentResults.push(result); attachmentNames.add(filename); return result; };
            for (const item of replacements) await ensureUpload(item.newFilename);
            for (const item of additions) await ensureUpload(item.newFilename);
            let storageHtml = page.storageHtml;
            const transformed = storage.transform(storageHtml, { replacements: replacements.map(item => ({ ...item, newFilename: item.newFilename })), additions }); storageHtml = transformed.html;
            onProgress({ stage: 'save', count: attachmentResults.length });
            const updated = await updatePage({ page, storageHtml, signal });
            const expectedVersion = Number(updated?.version?.number ?? updated?.version);
            if (!Number.isInteger(expectedVersion)) throw new Error('Confluence update did not return a page version');
            const verified = await verifyPage({ pageId: page.pageIdentity.pageId, expectedVersion, filenames: [...new Set([...replacements.map(item => item.newFilename), ...additions.map(item => item.newFilename)])], signal });
            if (!verified) throw new Error('Confluence post-save verification failed');
            return Object.freeze({ updated, verified: true, attachments: Object.freeze(attachmentResults), uploaded });
        }
        return Object.freeze({ apply });
    }
    root.DashBridgeConfluenceReportApply = Object.freeze({ create });
})(globalThis);
