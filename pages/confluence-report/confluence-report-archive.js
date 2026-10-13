(function initConfluenceReportArchive(root) {
    'use strict';
    const norm = value => String(value ?? '').normalize('NFKC').replace(/[_\s]+/g, ' ').trim();
    const parseFile = (capture, index) => {
        const file = String(capture?.file || ''); const parts = file.split('/'); const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
        const range = folder.match(/^(\d+)\s*(.*)$/u);
        // The source picker keys by panelId + title; retain duplicate series occurrences.
        const title = capture.seriesName && capture.occurrence != null
            ? `${capture.seriesName} [${capture.occurrence + 1}]` : capture.seriesName || capture.panelTitle;
        // rangeIndex preserves repeated periods; folders are presentation only.
        return { capture, index, file, rangeKey: String(capture.rangeIndex), rangeIndex: capture.rangeIndex + 1,
            rangeLabel: range ? norm(range[2]) : `${capture.from} → ${capture.to}`,
            panelId: capture.panelId, title: norm(title),
            from: capture.from, to: capture.to, source: null };
    };
    function analyze(archive) {
        const groups = new Map();
        for (const [index, capture] of (archive?.manifest?.captures || []).entries()) { const item = parseFile(capture, index); item.source = archive.sources?.get?.(capture.file) || null; const group = groups.get(item.rangeKey) || { rangeKey: item.rangeKey, rangeIndex: item.rangeIndex, label: item.rangeLabel, panels: [] }; group.panels.push(Object.freeze(item)); groups.set(item.rangeKey, group); }
        const ranges = [...groups.values()].sort((a, b) => (a.rangeIndex ?? 9999) - (b.rangeIndex ?? 9999)).map(group => Object.freeze({ ...group, panels: Object.freeze(group.panels), panelCount: group.panels.length }));
        const panels = [...new Map(ranges.flatMap(range => range.panels).map(item => [`${item.panelId}\0${item.title}`, item])).values()];
        return Object.freeze({ ranges: Object.freeze(ranges), panels: Object.freeze(panels), captureCount: ranges.reduce((count, range) => count + range.panels.length, 0) });
    }
    root.DashBridgeConfluenceReportArchive = Object.freeze({ analyze });
})(globalThis);
