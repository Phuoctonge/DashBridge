(function initConfluenceReportStorage(root) {
    'use strict';
    const text = value => String(value ?? '').trim();
    const escapeXml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
    const decodeXml = value => String(value ?? '').replace(/&quot;/gi, '"').replace(/&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&amp;/gi, '&');
    const escapeRegExp = value => text(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    function imageFilename(block) { return String(block || '').match(/ri:filename\s*=\s*["']([^"']+)["']/i)?.[1] || null; }
    function setFullWidth(block) { if (/\sstyle\s*=\s*["'][^"']*["']/i.test(block)) return block.replace(/(\sstyle\s*=\s*["'])[^"']*/i, '$1width: 100%;'); return block.replace(/<ac:image\b/i, '<ac:image style="width: 100%;"'); }
    function replaceImage(block, oldFilename, newFilename) { const pattern = new RegExp(`(ri:filename\\s*=\\s*["'])${escapeRegExp(oldFilename)}(["'])`, 'i'); if (!pattern.test(block)) return block; return setFullWidth(block.replace(pattern, `$1${newFilename}$2`)); }
    function groupRegion(html, insertion) {
        const headingPattern = /<h([1-6])\b[^>]*>[\s\S]*?<\/h\1>/gi;
        const headings = [...String(html).matchAll(headingPattern)].map(match => ({ index: match.index, end: match.index + match[0].length, level: Number(match[1]), title: decodeXml(text(match[0].replace(/^<h[1-6]\b[^>]*>|<\/h[1-6]>$/gi, ''))) }));
        const testTitle = text(insertion.testTitle);
        let currentTest = '';
        for (const heading of headings) {
            if (heading.level === 3) currentTest = heading.title;
            if (heading.level < 4 || heading.title.toLocaleLowerCase('ru-RU') !== text(insertion.groupTitle).toLocaleLowerCase('ru-RU')) continue;
            if (testTitle && currentTest !== testTitle) continue;
            const next = headings.find(candidate => candidate.index > heading.index && candidate.level <= heading.level);
            return { start: heading.end, end: next ? next.index : String(html).length };
        }
        return null;
    }
    function imageBlockAt(html, filename) {
        const pattern = /<ac:image\b[\s\S]*?<\/ac:image>|<ac:image\b[^>]*\/>/gi;
        for (const match of String(html).matchAll(pattern)) if (imageFilename(match[0]) === filename) return match;
        return null;
    }
    function transform(storageHtml, plan = {}) {
        let html = String(storageHtml || ''); const applied = []; const replacements = Array.isArray(plan.replacements) ? plan.replacements : [];
        for (const item of replacements) { const oldFilename = text(item.oldFilename); const newFilename = text(item.newFilename); if (!oldFilename || !newFilename) throw new Error('Replacement requires oldFilename and newFilename'); let occurrence = 0; let changed = false; html = html.replace(/<ac:image\b[\s\S]*?<\/ac:image>|<ac:image\b[^>]*\/>/gi, block => { if (imageFilename(block) !== oldFilename) return block; if (item.occurrence != null && occurrence++ !== Number(item.occurrence)) return block; changed = true; return replaceImage(block, oldFilename, newFilename); }); if (!changed) throw new Error(`Attachment not found: ${oldFilename}`); applied.push({ ...item, oldFilename, newFilename }); }
        const additions = Array.isArray(plan.additions) ? plan.additions : [];
        for (const item of additions) {
            const filename = text(item.newFilename); const caption = text(item.caption);
            if (!filename || !caption) throw new Error('Addition requires filename and caption');
            const block = `<p>${escapeXml(caption)}</p><ac:image style="width: 100%;"><ri:attachment ri:filename="${escapeXml(filename)}" /></ac:image>`;
            const insertion = item.insertion || {};
            if (insertion.groupTitle) {
                const region = groupRegion(html, insertion);
                if (region) {
                    const scoped = html.slice(region.start, region.end);
                    if (insertion.beforeFilename) {
                        const before = imageBlockAt(scoped, insertion.beforeFilename);
                        if (before) { const offset = region.start + before.index; html = html.slice(0, offset) + block + html.slice(offset); continue; }
                    }
                    html = html.slice(0, region.start) + (insertion.kind === 'group' ? `<h4>${escapeXml(insertion.sectionTitle || 'Новая группа')}</h4>` : '') + block + html.slice(region.start); continue;
                }
                throw new Error(`Target group not found: ${insertion.groupTitle}`);
            }
            html += `<h4>${escapeXml(insertion.sectionTitle || 'Новый раздел')}</h4>${block}`;
        }
        return Object.freeze({ html, changed: html !== storageHtml, applied: Object.freeze(applied) });
    }
    root.DashBridgeConfluenceReportStorage = Object.freeze({ transform });
})(globalThis);
