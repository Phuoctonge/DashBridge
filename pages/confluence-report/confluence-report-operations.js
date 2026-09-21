(function initConfluenceReportOperations(root) {
    'use strict';
    const norm = value => String(value ?? '').normalize('NFKC').replace(/[_\s]+/g, ' ').trim().toLocaleLowerCase('ru-RU');
    const imageRecords = snapshot => (snapshot?.tests || []).flatMap(test => (test.groups || []).flatMap(group => (group.images || []).map(image => ({ test, group, image }))));
    function create(input = {}) { return Object.freeze({ id: input.id || `op-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, action: input.action === 'add' ? 'add' : 'replace', sourceKey: String(input.sourceKey || ''), targetMetric: String(input.targetMetric || ''), scope: input.scope === 'selected' ? 'selected' : 'all', testKeys: Object.freeze(Array.isArray(input.testKeys) ? input.testKeys.slice() : []), caption: String(input.caption || ''), anchor: String(input.anchor || '') }); }
    function expand(list, snapshot, sources = []) {
        const records = imageRecords(snapshot); const result = [];
        for (const operation of list || []) {
            const targets = operation.scope === 'selected' ? records.filter(item => operation.testKeys.includes(item.test.testKey)) : records;
            const matching = targets.filter(item => operation.action === 'add' || (!operation.targetMetric || norm(item.image.captionLead || item.image.caption) === norm(operation.targetMetric)));
            for (const target of matching) result.push(Object.freeze({ operationId: operation.id, action: operation.action, testKey: target.test.testKey, testTitle: target.test.title, groupTitle: target.group.title, occurrence: target.image.occurrence, target, source: sources.find(source => `${source.panelId || ''}\0${source.title || ''}` === operation.sourceKey) || null, caption: operation.caption || target.image.captionLead || '', anchor: operation.anchor || null }));
        }
        return Object.freeze(result);
    }
    root.DashBridgeConfluenceReportOperations = Object.freeze({ create, expand });
})(globalThis);
