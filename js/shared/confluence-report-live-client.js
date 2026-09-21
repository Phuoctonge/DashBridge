(function initConfluenceReportLiveClient(root) {
    'use strict';

    const MAX_STORAGE_BYTES = 8 * 1024 * 1024;
    const MAX_ATTACHMENTS = 200;

    function baseOrigin(value) {
        const url = new URL(String(value || ''));
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
            throw new Error('Confluence base URL must be an HTTP(S) origin without credentials');
        }
        return url.origin;
    }

    function pagePath(pageId) {
        const value = String(pageId || '').trim();
        if (!/^\d{1,20}$/.test(value)) throw new Error('Confluence page ID must be numeric');
        return value;
    }

    function create({ fetchRef = root.fetch, schema = root.DashBridgeConfluenceReportLiveSchema, scanner = root.DashBridgeConfluenceReportScanner } = {}) {
        if (typeof fetchRef !== 'function') throw new Error('Confluence live client requires fetch');
        if (!schema?.normalizePage || !scanner?.fromStorageHtml) throw new Error('Confluence live client dependencies are unavailable');

        const requestJson = async (url, signal) => {
            const response = await fetchRef(url, { credentials: 'same-origin', headers: { Accept: 'application/json' }, signal });
            if (!response.ok) throw new Error(`Confluence request failed (${response.status})`);
            return response.json();
        };

        const scan = async ({ baseUrl, pageId, signal } = {}) => {
            const origin = baseOrigin(baseUrl);
            const id = pagePath(pageId);
            const pageUrl = `${origin}/rest/api/content/${id}?expand=body.storage,version,space,metadata.labels`;
            const attachmentsUrl = `${origin}/rest/api/content/${id}/child/attachment?limit=${MAX_ATTACHMENTS}&expand=version,metadata`;
            const [content, attachments] = await Promise.all([requestJson(pageUrl, signal), requestJson(attachmentsUrl, signal)]);
            const page = schema.normalizePage({ currentUrl: `${origin}/pages/viewpage.action?pageId=${id}`, content, attachments });
            if (page.storageHtml.length > MAX_STORAGE_BYTES) throw new Error('Confluence storage body exceeds the safe scan limit');
            const snapshot = scanner.fromStorageHtml(page.storageHtml, { pageIdentity: page.pageIdentity, editorKind: page.editorKind });
            return Object.freeze({ page, snapshot, source: Object.freeze({ origin, pageId: id }) });
        };

        return Object.freeze({ scan });
    }

    root.DashBridgeConfluenceReportLiveClient = Object.freeze({ create });
})(globalThis);
