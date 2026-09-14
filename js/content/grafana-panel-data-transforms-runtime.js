(function initPanelDataTransformsRuntime(root) {
    'use strict';
    const createWorkspace = (data, targetRefIds, helperRefIds = new Set()) => {
        const privateHelperRefIds = new Set(helperRefIds || []);
        if (targetRefIds === null) return { data, isolated: false, helperRefIds: privateHelperRefIds };
        const includedRefIds = new Set([...targetRefIds, ...privateHelperRefIds]);
        return { data: { ...data, results: Object.fromEntries(Object.entries(data?.results || {}).filter(([refId]) => includedRefIds.has(String(refId)))) }, isolated: true, helperRefIds: privateHelperRefIds };
    };
    const commitWorkspace = (target, workspace) => {
        if (!workspace?.isolated) return target;
        workspace.helperRefIds.forEach(refId => delete target.results?.[refId]);
        Object.assign(target.results, workspace.data.results);
        return target;
    };
    root.DashBridgeGrafanaPanelDataTransformsRuntime = Object.freeze({ createWorkspace, commitWorkspace });
})(globalThis);
