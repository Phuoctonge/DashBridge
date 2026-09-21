(function initConfluenceReportLiveSchema(root) {
    'use strict';

    const text = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    const optionalText = value => text(value) || null;

    function pageIdFromUrl(value) {
        try {
            const url = new URL(String(value || ''));
            return url.searchParams.get('pageId') || url.pathname.match(/\/pages\/(?:viewpage|editpage)\.action\/(\d+)/i)?.[1] || null;
        } catch {
            return null;
        }
    }

    function normalizeAttachment(item) {
        if (!item || typeof item !== 'object') return null;
        return Object.freeze({
            id: optionalText(item.id),
            title: text(item.title),
            version: Number.isInteger(item.version?.number) ? item.version.number : null,
            mediaType: optionalText(item.metadata?.mediaType),
            fileSize: Number.isFinite(item.extensions?.fileSize) ? item.extensions.fileSize : null,
            download: optionalText(item._links?.download),
        });
    }

    function normalizePage(input) {
        const content = input?.content;
        if (!content || content.type !== 'page' || !content.id) throw new Error('Confluence page response is invalid');
        const storage = content.body?.storage;
        if (!storage || storage.representation !== 'storage' || typeof storage.value !== 'string') {
            throw new Error('Confluence page storage representation is unavailable');
        }
        const pageId = text(content.id) || pageIdFromUrl(input?.currentUrl);
        if (!pageId) throw new Error('Confluence page ID is unavailable');
        const attachments = (input?.attachments?.results || []).map(normalizeAttachment).filter(Boolean);
        return Object.freeze({
            pageIdentity: Object.freeze({
                pageId,
                title: text(content.title),
                spaceKey: text(content.space?.key),
                version: Number.isInteger(content.version?.number) ? content.version.number : null,
            }),
            storageHtml: storage.value,
            attachments: Object.freeze(attachments),
            editorKind: 'storage-rest',
        });
    }

    root.DashBridgeConfluenceReportLiveSchema = Object.freeze({ normalizePage });
})(globalThis);
