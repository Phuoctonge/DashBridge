(function initConfluenceReportStorage(root) {
    'use strict';
    const text = value => String(value ?? '').trim();
    const escapeXml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
    const escapeRegExp = value => text(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    function imageFilename(block) { return String(block || '').match(/ri:filename\s*=\s*["']([^"']+)["']/i)?.[1] || null; }
    function setFullWidth(block) { if (/\sstyle\s*=\s*["'][^"']*["']/i.test(block)) return block.replace(/(\sstyle\s*=\s*["'])[^"']*/i, '$1width: 100%;'); return block.replace(/<ac:image\b/i, '<ac:image style="width: 100%;"'); }
    function replaceImage(block, oldFilename, newFilename) { const pattern = new RegExp(`(ri:filename\\s*=\\s*["'])${escapeRegExp(oldFilename)}(["'])`, 'i'); if (!pattern.test(block)) return block; return setFullWidth(block.replace(pattern, `$1${newFilename}$2`)); }
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
                const heading = new RegExp(`(<h[1-6]\\b[^>]*>\\s*${escapeRegExp(insertion.groupTitle)}\\s*</h[1-6]>)`, 'i');
                if (heading.test(html)) {
                    if (insertion.beforeFilename) {
                        const before = new RegExp(`(<ac:image\\b[\\s\\S]*?ri:filename\\s*=\\s*["']${escapeRegExp(insertion.beforeFilename)}["'][\\s\\S]*?<\\/ac:image>|<ac:image\\b[^>]*ri:filename\\s*=\\s*["']${escapeRegExp(insertion.beforeFilename)}["'][^>]*\\/>)`, 'i');
                        if (before.test(html)) { html = html.replace(before, `${block}$1`); continue; }
                    }
                    html = html.replace(heading, `$1${insertion.kind === 'group' ? `<h4>${escapeXml(insertion.sectionTitle || 'Новая группа')}</h4>` : ''}${block}`); continue;
                }
                throw new Error(`Target group not found: ${insertion.groupTitle}`);
            }
            html += `<h4>${escapeXml(insertion.sectionTitle || 'Новый раздел')}</h4>${block}`;
        }
        return Object.freeze({ html, changed: html !== storageHtml, applied: Object.freeze(applied) });
    }
    root.DashBridgeConfluenceReportStorage = Object.freeze({ transform });
})(globalThis);
