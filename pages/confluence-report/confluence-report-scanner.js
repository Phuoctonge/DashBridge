(function initConfluenceReportScanner(root) {
    'use strict';
    const strip = value => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/\s+/g, ' ').trim();
    const normalize = value => strip(value).normalize('NFKC');
    const attr = (tag, name) => (String(tag).match(new RegExp(`${name}\\s*=\\s*["']([^"']+)`, 'i')) || [])[1] || null;
    const imageReference = body => { const a = String(body).match(/<ri:attachment\b[^>]*>/i); if (a) return { filename: attr(a[0], 'ri:filename') }; const i = String(body).match(/<img\b[^>]*>/i); return i ? { src: attr(i[0], 'src'), alt: attr(i[0], 'alt') } : null; };
    const fingerprint = value => { let hash = 0x811c9dc5; for (const char of String(value)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 0x01000193); } return (hash >>> 0).toString(16).padStart(8, '0'); };
    function fromStorageHtml(html, context = {}) {
        const tests = []; let currentTest = null; let currentGroup = null; let pendingCaption = null;
        const pattern = /<h([1-6])\b[^>]*>[\s\S]*?<\/h\1>|<p\b[^>]*>[\s\S]*?<\/p>|<ac:image\b[^>]*>[\s\S]*?<\/ac:image>|<img\b[^>]*>/gi;
        for (const match of String(html ?? '').matchAll(pattern)) {
            const token = match[0]; const heading = token.match(/^<h([1-6])\b/i);
            if (heading) { const level = Number(heading[1]); const title = normalize(token.replace(/^<h[1-6]\b[^>]*>|<\/h[1-6]>$/gi, '')); if (level <= 3) { currentTest = { title, groups: [] }; tests.push(currentTest); currentGroup = null; } else if (currentTest) { currentGroup = { title, images: [] }; currentTest.groups.push(currentGroup); } pendingCaption = null; continue; }
            if (/^<p\b/i.test(token)) { pendingCaption = normalize(token.replace(/^<p\b[^>]*>|<\/p>$/gi, '')); continue; }
            if (!currentTest) continue; if (!currentGroup) { currentGroup = { title: '', images: [] }; currentTest.groups.push(currentGroup); }
            const ref = imageReference(token); if (!ref) continue;
            currentGroup.images.push({ occurrence: currentGroup.images.length, caption: pendingCaption || '', imageReference: ref, sourceLocation: { offset: match.index } }); pendingCaption = null;
        }
        const resultTests = tests.map((test, index) => Object.freeze({ testKey: `test-${String(index + 1).padStart(2, '0')}`, title: test.title, groups: Object.freeze(test.groups.map(group => Object.freeze({ title: group.title, images: Object.freeze(group.images.map(image => Object.freeze(image))) }))) }));
        return Object.freeze({ pageIdentity: context.pageIdentity || null, editorKind: context.editorKind || 'storage-textarea', tests: Object.freeze(resultTests), fingerprint: fingerprint(JSON.stringify(resultTests)) });
    }
    root.DashBridgeConfluenceReportScanner = Object.freeze({ fromStorageHtml });
})(globalThis);
