(function initConfluenceReportScanner(root) {
    'use strict';
    const strip = value => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/\s+/g, ' ').trim();
    const normalize = value => strip(value).normalize('NFKC');
    const lower = value => normalize(value).toLocaleLowerCase('ru-RU');
    const attr = (tag, name) => (String(tag).match(new RegExp(`${name}\\s*=\\s*["']([^"']+)`, 'i')) || [])[1] || null;
    const imageReference = body => { const a = String(body).match(/<ri:attachment\b[^>]*>/i); if (a) return { filename: attr(a[0], 'ri:filename') }; const i = String(body).match(/<img\b[^>]*>/i); return i ? { src: attr(i[0], 'src'), alt: attr(i[0], 'alt') } : null; };
    const fingerprint = value => { let hash = 0x811c9dc5; for (const char of String(value)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 0x01000193); } return (hash >>> 0).toString(16).padStart(8, '0'); };
    function normalizeHeadingFamily(value) { let text = normalize(value).replace(/\s+/g, ' '); text = text.replace(/(.{4,}?)\1(?=\d+\s*$)/iu, '$1'); text = text.replace(/\s*[-–—]?\s*\d+\s*$/u, '').trim(); return lower(text); }
    function extractCaptionParts(value) {
        const original = normalize(value); if (!original) return { original: '', lead: '', details: '', confidence: 'none' };
        const intro = /^(?:на\s+(?:рисунке|графике)(?:\s+(?:далее|ниже|выше))?|на\s+следующ(?:ем|ей)\s+(?:рисунке|графике))(?:\s+(?:можно\s+увидеть|представлен(?:а|о|ы)?|показан(?:о|а|ы)?|изображен(?:о|а|ы)?))?\s*/iu;
        const match = original.match(intro); const text = (match ? original.slice(match[0].length) : original).trim();
        const sentence = (text.match(/.*?[.!?](?:\s|$)|.+$/u) || [''])[0];
        return { original, lead: normalize(sentence).replace(/[.!?]+$/u, '').trim(), details: normalize(text.slice(sentence.length).trim()), confidence: match ? 'high' : (sentence !== text ? 'medium' : 'low') };
    }
    function fromStorageHtml(html, context = {}) {
        const tests = []; let currentTest = null; let currentGroup = null; let pendingCaption = null; const headingStack = [];
        // Confluence wraps images in paragraphs: stop the caption before the image,
        // keeping its original storage offset for exact replacement and insertion.
        const pattern = /<h([1-6])\b[^>]*>[\s\S]*?<\/h\1>|<p\b[^>]*>(?:(?!<\/p>|<ac:image\b|<img\b)[\s\S])*(?:<\/p>|(?=<ac:image\b|<img\b))|<ac:image\b[^>]*>[\s\S]*?<\/ac:image>|<img\b[^>]*>/gi;
        for (const match of String(html ?? '').matchAll(pattern)) {
            const token = match[0]; const heading = token.match(/^<h([1-6])\b/i);
            if (heading) { const level = Number(heading[1]); const title = normalize(token.replace(/^<h[1-6]\b[^>]*>|<\/h[1-6]>$/gi, '')); headingStack.splice(level - 1); headingStack[level - 1] = title; if (level === 3) { currentTest = { title, groups: [] }; tests.push(currentTest); currentGroup = null; } else if (level >= 4 && currentTest) { currentGroup = { title, headingPath: headingStack.slice(3).filter(Boolean), images: [] }; currentTest.groups.push(currentGroup); } pendingCaption = null; continue; }
            if (/^<p\b/i.test(token)) { const caption = normalize(token.replace(/^<p\b[^>]*>|<\/p>$/gi, '')); if (caption || /<\/p>$/i.test(token)) pendingCaption = caption; continue; }
            if (!currentTest) continue; if (!currentGroup) { currentGroup = { title: '', headingPath: [], images: [] }; currentTest.groups.push(currentGroup); }
            const ref = imageReference(token); if (!ref) continue; const caption = extractCaptionParts(pendingCaption || ''); const explicitKey = attr(token, 'data-dashbridge-key') || attr(token, 'data-dashbridge-metric') || null;
            currentGroup.images.push({ occurrence: currentGroup.images.length, caption: caption.original, captionOriginal: caption.original, captionLead: caption.lead, captionDetails: caption.details, captionConfidence: caption.confidence, captionFingerprint: fingerprint(lower(caption.lead)), explicitKey, headingPath: currentGroup.headingPath.slice(), imageReference: ref, sourceLocation: { offset: match.index } }); pendingCaption = null;
        }
        const resultTests = tests.map((test, index) => Object.freeze({ testKey: `test-${String(index + 1).padStart(2, '0')}`, title: test.title, groups: Object.freeze(test.groups.map(group => Object.freeze({ title: group.title, normalizedGroupFamily: normalizeHeadingFamily(group.title), headingPath: Object.freeze(group.headingPath.slice()), images: Object.freeze(group.images.map(image => Object.freeze(image))) }))) }));
        return Object.freeze({ pageIdentity: context.pageIdentity || null, editorKind: context.editorKind || 'storage-textarea', tests: Object.freeze(resultTests), fingerprint: fingerprint(JSON.stringify(resultTests)) });
    }
    root.DashBridgeConfluenceReportScanner = Object.freeze({ fromStorageHtml, normalizeHeadingFamily, extractCaptionParts });
})(globalThis);
