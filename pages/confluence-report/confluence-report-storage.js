(function initConfluenceReportStorage(root) {
    'use strict';
    const text = value => String(value ?? '').trim();
    const escapeRegExp = value => text(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    function imageFilename(block) { return String(block || '').match(/ri:filename\s*=\s*["']([^"']+)["']/i)?.[1] || null; }
    function setFullWidth(block) { if (/\sstyle\s*=\s*["'][^"']*["']/i.test(block)) return block.replace(/(\sstyle\s*=\s*["'])[^"']*/i, '$1width: 100%;'); return block.replace(/<ac:image\b/i, '<ac:image style="width: 100%;"'); }
    function replaceImage(block, oldFilename, newFilename) { const pattern = new RegExp(`(ri:filename\\s*=\\s*["'])${escapeRegExp(oldFilename)}(["'])`, 'i'); if (!pattern.test(block)) return block; return setFullWidth(block.replace(pattern, `$1${newFilename}$2`)); }
    function transform(storageHtml, plan = {}) {
        let html = String(storageHtml || ''); const applied = []; const replacements = Array.isArray(plan.replacements) ? plan.replacements : [];
        for (const item of replacements) { const oldFilename = text(item.oldFilename); const newFilename = text(item.newFilename); if (!oldFilename || !newFilename) throw new Error('Replacement requires oldFilename and newFilename'); let occurrence = 0; let changed = false; html = html.replace(/<ac:image\b[\s\S]*?<\/ac:image>|<ac:image\b[^>]*\/>/gi, block => { if (imageFilename(block) !== oldFilename) return block; if (item.occurrence != null && occurrence++ !== Number(item.occurrence)) return block; changed = true; return replaceImage(block, oldFilename, newFilename); }); if (!changed) throw new Error(`Attachment not found: ${oldFilename}`); applied.push({ ...item, oldFilename, newFilename }); }
        return Object.freeze({ html, changed: html !== storageHtml, applied: Object.freeze(applied) });
    }
    root.DashBridgeConfluenceReportStorage = Object.freeze({ transform });
})(globalThis);
