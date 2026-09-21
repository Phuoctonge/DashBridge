(function initConfluenceReportMappingBoard(root) {
    'use strict';
    const norm = value => String(value ?? '').normalize('NFKC').replace(/[_\s]+/g, ' ').trim().toLocaleLowerCase('ru-RU');
    function randomConnectionColor() { const hue = Math.floor(Math.random() * 360); return `hsl(${hue} 78% 45%)`; }
    function createConnection(input = {}) { return Object.freeze({ id: input.id || `link-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, sourceKey: String(input.sourceKey || ''), targetKey: String(input.targetKey || ''), mode: input.mode === 'specific' ? 'specific' : 'group', color: String(input.color || randomConnectionColor()) }); }
    function resolveConnections(connections, target) { const specific = connections.filter(item => item.mode === 'specific' && item.targetKey === [target.testKey, target.groupTitle || 'group', norm(target.metric), target.occurrence ?? 0].join('\0')); if (specific.length) return specific; const grouped = `metric\0${target.groupTitle || 'Без раздела'}\0${norm(target.metric)}`; return connections.filter(item => item.mode === 'group' && (item.targetKey === grouped || item.targetKey === `metric\0${norm(target.metric)}`)); }
    function findNode(nodes, attribute, value) { return [...(nodes || [])].find(node => node?.dataset?.[attribute] === value) || null; }
    const colors = Object.freeze(['#2563eb', '#db2777', '#7c3aed', '#ea580c', '#0891b2', '#65a30d', '#dc2626', '#4f46e5']);
    function colorForKey(value) { let hash = 0; for (const char of String(value || '')) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0; return colors[Math.abs(hash) % colors.length]; }
    function sourceIdentity(value) { const parts = String(value || '').split('\0'); return `${parts.at(-2) || ''}\0${parts.at(-1) || ''}`; }
    root.DashBridgeConfluenceReportMappingBoard = Object.freeze({ createConnection, resolveConnections, findNode, colorForKey, sourceIdentity, randomConnectionColor });
})(globalThis);
