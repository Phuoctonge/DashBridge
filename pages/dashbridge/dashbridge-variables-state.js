(function initDashBridgeVariablesState(root) {
    'use strict';
    function scope(src) {
        try {
            const url = new URL(src);
            const route = url.pathname.match(/^(.*?)\/d(?:-solo)?\/([^/]+)(?:\/|$)/);
            if (!route || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
            // Omitted orgId means the user's current organization, not necessarily 1.
            return JSON.stringify([url.origin, route[1], route[2], url.searchParams.get('orgId') || '']);
        } catch { return null; }
    }
    function normalize(snapshot) {
        if (!snapshot || !Array.isArray(snapshot.variables) || snapshot.variables.length > 100) return null;
        const names = new Set();
        const text = value => typeof value === 'string' && value.length <= 16000;
        const variables = [];
        let size = 0;
        for (const variable of snapshot.variables) {
            if (!variable || !text(variable.name) || !variable.name || variable.name.length > 200
                || names.has(variable.name) || !text(variable.label)
                || !Array.isArray(variable.values) || variable.values.length > 5000
                || !variable.values.every(text) || !Array.isArray(variable.options) || variable.options.length > 5000) return null;
            names.add(variable.name);
            for (const option of variable.options) {
                if (!option || !text(option.value) || !text(option.text)) return null;
                size += option.value.length + option.text.length;
            }
            size += variable.values.join('').length;
            if (size > 1800000) return null;
            variables.push({ ...variable, supported: variable.supported === true && !variable.skipUrlSync,
                dependencies: Array.isArray(variable.dependencies) ? variable.dependencies.filter(text).slice(0, 100) : [],
                multi: variable.multi === true, includeAll: variable.includeAll === true,
                texts: Array.isArray(variable.texts) && variable.texts.every(text) ? variable.texts : variable.values });
        }
        return { adapter: snapshot.adapter === 'scenes' ? 'scenes' : 'template', variables };
    }
    function apply(src, variables) {
        if (!scope(src)) throw new TypeError('Некорректный URL Grafana');
        const url = new URL(src);
        for (const variable of variables) {
            if (!variable.supported || variable.skipUrlSync) continue;
            const key = `var-${variable.name}`;
            url.searchParams.delete(key);
            const values = variable.values.includes('$__all') && variable.includeAll
                ? ['$__all'] : variable.multi ? variable.values : variable.values.slice(0, 1);
            for (const value of values) url.searchParams.append(key, value);
        }
        // Match local-state-schema's persisted HTTP URL budget before a caller
        // navigates a frame or mutates the profile draft.
        if (url.href.length > 4096) throw new RangeError('Выберите меньше значений: адрес панели превышает 4096 символов и не может быть сохранён.');
        return url.href;
    }
    function resetDependents(src, variables, changedName) {
        const affected = new Set([changedName]);
        for (let pass = 0; pass < variables.length; pass++) {
            for (const variable of variables) {
                if (variable.dependencies?.some(name => affected.has(name))) affected.add(variable.name);
            }
        }
        const url = new URL(src);
        affected.delete(changedName);
        affected.forEach(name => url.searchParams.delete(`var-${name}`));
        return url.href;
    }
    root.DashBridgeVariablesState = Object.freeze({ scope, normalize, apply, resetDependents });
})(globalThis);
