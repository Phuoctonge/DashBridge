(function initConfluenceReportArchive(root) {
    'use strict';
    const norm = value => String(value ?? '').normalize('NFKC').replace(/[_\s]+/g, ' ').trim();
    const basename = value => String(value || '').replace(/\\/g, '/').split('/').pop() || '';
    const parseFile = (capture, index) => {
        const file = String(capture?.file || ''); const parts = file.split('/'); const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
        const name = basename(file).replace(/\.[a-z0-9]{2,8}$/i, '');
        const panel = name.match(/^panel-([^_]+)_(.+?)_(\d+)_([\d]+)(?:_[a-z0-9]+)?$/i);
        const range = folder.match(/^(\d+)\s*(.*)$/u);
        return { capture, index, file, rangeKey: folder || `unfoldered-${index}`, rangeIndex: range ? Number(range[1]) : null, rangeLabel: range ? norm(range[2]) : 'Без временного диапазона', panelId: capture.panelId || (panel && panel[1]) || null, title: norm(capture.panelTitle || (panel && panel[2]) || 'Без названия'), from: capture.from || (panel && panel[3]) || null, to: capture.to || (panel && panel[4]) || null, source: null };
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
