(function initConfluenceReportStorage(root) {
    'use strict';
    const text = value => String(value ?? '').trim();
    const escapeXml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
    const decodeXml = value => String(value ?? '').replace(/&quot;/gi, '"').replace(/&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&amp;/gi, '&');
    const escapeRegExp = value => text(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    function imageFilename(block) { return String(block || '').match(/ri:filename\s*=\s*["']([^"']+)["']/i)?.[1] || null; }
    const imageBlocks = html => [...String(html).matchAll(/<ac:image\b[^>]*\/>|<ac:image\b[^>]*>[\s\S]*?<\/ac:image>/gi)];
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
        for (const match of imageBlocks(html)) if (imageFilename(match[0]) === filename) return match;
        return null;
    }
    function captionStartBefore(html, imageIndex) {
        let candidate = null;
        for (const match of String(html).slice(0, imageIndex).matchAll(/<p\b[^>]*>[\s\S]*?<\/p>/gi)) candidate = match.index;
        return candidate;
    }
    function verifyPlan(storageHtml, plan = {}) {
        const html = String(storageHtml || '');
        if (typeof plan.expectedStorageHtml === 'string') {
            const references = value => imageBlocks(value).map(match => decodeXml(imageFilename(match[0])));
            if (JSON.stringify(references(html)) !== JSON.stringify(references(plan.expectedStorageHtml))) return false;
        }
        for (const item of Array.isArray(plan.additions) ? plan.additions : []) {
            const insertion = item.insertion || {};
            if (!insertion.groupTitle) continue;
            const region = groupRegion(html, insertion);
            if (!region) return false;
            const scoped = html.slice(region.start, region.end);
            const image = imageBlockAt(scoped, text(item.newFilename));
            if (!image) return false;
            const caption = `<p>${escapeXml(item.caption)}</p>`;
            const captionIndex = scoped.lastIndexOf(caption, image.index);
            if (captionIndex < 0 || captionIndex > image.index || /<ac:image\b/i.test(scoped.slice(captionIndex + caption.length, image.index))) return false;
            if (insertion.beforeFilename && typeof plan.expectedStorageHtml !== 'string') {
                const anchor = imageBlockAt(scoped, insertion.beforeFilename);
                if (!anchor || image.index >= anchor.index) return false;
            }
        }
        return true;
    }
    function transform(storageHtml, plan = {}) {
        const originalHtml = String(storageHtml || '');
        const originals = imageBlocks(originalHtml);
        const replacementByOffset = new Map();
        const applied = []; const replacements = Array.isArray(plan.replacements) ? plan.replacements : [];
        // Every selector addresses the scan baseline, never the result of an earlier rename.
        for (const item of replacements) {
            const oldFilename = text(item.oldFilename); const newFilename = text(item.newFilename);
            if (!oldFilename || !newFilename) throw new Error('Replacement requires oldFilename and newFilename');
            let matches = originals.filter(match => imageFilename(match[0]) === oldFilename);
            if (item.sourceOffset != null) {
                if (!Number.isInteger(item.sourceOffset) || item.sourceOffset < 0) throw new Error('Replacement target offset is invalid');
                matches = matches.filter(match => match.index === item.sourceOffset);
                if (!matches.length) throw new Error(`Replacement target does not match: ${oldFilename}`);
            } else if (item.occurrence != null) {
                if (!Number.isInteger(item.occurrence) || item.occurrence < 0) throw new Error('Replacement target occurrence is invalid');
                matches = matches.slice(item.occurrence, item.occurrence + 1);
            }
            if (!matches.length) throw new Error(`Attachment not found: ${oldFilename}`);
            for (const match of matches) {
                const previous = replacementByOffset.get(match.index);
                if (previous && previous.newFilename !== newFilename) throw new Error(`Conflicting replacement target: ${oldFilename}`);
                replacementByOffset.set(match.index, { oldFilename, newFilename });
            }
            applied.push({ ...item, oldFilename, newFilename });
        }
        let html = ''; let cursor = 0;
        const currentOffsets = new Map();
        for (const match of originals) {
            html += originalHtml.slice(cursor, match.index);
            currentOffsets.set(match.index, html.length);
            const replacement = replacementByOffset.get(match.index);
            html += replacement ? replaceImage(match[0], replacement.oldFilename, replacement.newFilename) : match[0];
            cursor = match.index + match[0].length;
        }
        html += originalHtml.slice(cursor);
        const insert = (offset, block) => {
            html = html.slice(0, offset) + block + html.slice(offset);
            for (const [sourceOffset, currentOffset] of currentOffsets) if (currentOffset >= offset) currentOffsets.set(sourceOffset, currentOffset + block.length);
        };
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
                    if (insertion.beforeFilename || insertion.beforeSourceOffset != null) {
                        let sourceOffset = insertion.beforeSourceOffset;
                        const originalRegion = groupRegion(originalHtml, insertion);
                        if (sourceOffset == null && originalRegion) {
                            const originalAnchor = imageBlockAt(originalHtml.slice(originalRegion.start, originalRegion.end), insertion.beforeFilename);
                            if (originalAnchor) sourceOffset = originalRegion.start + originalAnchor.index;
                        }
                        if (sourceOffset != null) {
                            const originalAnchor = originals.find(match => match.index === sourceOffset);
                            if (!Number.isInteger(sourceOffset) || !originalAnchor || !originalRegion || sourceOffset < originalRegion.start || sourceOffset >= originalRegion.end || (insertion.beforeFilename && imageFilename(originalAnchor[0]) !== insertion.beforeFilename)) throw new Error('Addition anchor does not match the scan baseline');
                            const beforeIndex = currentOffsets.get(sourceOffset) - region.start;
                            const captionStart = captionStartBefore(scoped, beforeIndex);
                            insert(region.start + (captionStart == null ? beforeIndex : captionStart), block); continue;
                        }
                    }
                    insert(region.start, (insertion.kind === 'group' ? `<h4>${escapeXml(insertion.sectionTitle || 'Новая группа')}</h4>` : '') + block); continue;
                }
                throw new Error(`Target group not found: ${insertion.groupTitle}`);
            }
            html += `<h4>${escapeXml(insertion.sectionTitle || 'Новый раздел')}</h4>${block}`;
        }
        return Object.freeze({ html, changed: html !== storageHtml, applied: Object.freeze(applied) });
    }
    root.DashBridgeConfluenceReportStorage = Object.freeze({ transform, verifyPlan });
})(globalThis);
