(function initGrafanaVariablesRuntime(root) {
    'use strict';
    // MAIN owns access to Grafana objects, never Chrome API. The isolated
    // bridge authorizes the parent and correlates this bounded read operation.
    root.DashBridgeGrafanaVariablesRuntime?.stop();
    if (root === root.parent) return;
    let stopped = false;
    let busy = false;
    let timer = null;
    let wake = null;
    const pause = () => new Promise(resolve => {
        wake = resolve;
        timer = setTimeout(() => { timer = null; wake = null; resolve(); }, 200);
    });
    const strings = value => (Array.isArray(value) ? value : value == null ? [] : [value])
        .map(String).slice(0, 5000);

    function sceneVariables() {
        const seen = new Set();
        for (const element of Array.from(document.querySelectorAll('div, canvas')).slice(0, 600)) {
            let fiber = element[Object.keys(element).find(key => key.startsWith('__reactFiber'))];
            for (let depth = 0; fiber && depth < 60; depth++, fiber = fiber.return) {
                if (seen.has(fiber)) break;
                seen.add(fiber);
                const props = fiber.memoizedProps;
                for (const key of ['model', 'scene', 'dashboard']) {
                    let model = props?.[key];
                    for (let parent = 0; model && parent < 12; parent++, model = model.parent || model._parent) {
                        const variables = model.state?.$variables?.state?.variables;
                        if (Array.isArray(variables)) return variables;
                    }
                }
            }
        }
        return null;
    }

    function projectVariable(variable, scene) {
        const state = scene ? variable.state : variable;
        const current = scene ? { value: state.value, text: state.text } : state.current;
        const options = (state.options || []).map(option => ({
            value: String(option.value ?? ''), text: String(option.label ?? option.text ?? option.value ?? '')
        }));
        if (state.includeAll && !options.some(option => option.value === '$__all')) {
            options.unshift({ value: '$__all', text: 'All' });
        }
        if (options.length > 5000) throw new Error('Слишком много вариантов: откройте фильтр в Grafana.');
        const supported = ['query', 'datasource', 'custom', 'interval', 'textbox', 'constant'].includes(state.type)
            && !state.skipUrlSync;
        return {
            name: String(state.name || ''), label: String(state.label || state.name || ''),
            type: String(state.type || ''), multi: !!(state.isMulti ?? state.multi),
            includeAll: !!state.includeAll, hide: Number(state.hide || 0),
            skipUrlSync: !!state.skipUrlSync, supported, options,
            values: strings(current?.value), texts: strings(current?.text),
            allowCustomValue: state.allowCustomValue === true,
            dependencies: [...new Set(Array.from(JSON.stringify({ query: state.query, datasource: state.datasource,
                regex: state.regex, definition: state.definition }).matchAll(/\$\{([^}:]+)(?::[^}]+)?\}|\[\[([^\]:]+)(?::[^\]]+)?\]\]|\$([A-Za-z_][A-Za-z0-9_]*)/g),
            match => match[1] || match[2] || match[3]))],
            loading: !!state.loading || state.state === 'Loading', error: !!state.error,
        };
    }

    async function inspect(refreshName, change) {
        if (typeof root.System?.import !== 'function') return null;
        const runtime = await root.System.import('@grafana/runtime');
        if (stopped) return null;
        const scenes = sceneVariables();
        if (scenes) {
            if (change) {
                const variable = scenes.find(item => item.state?.name === change.name);
                if (typeof variable?.changeValueTo !== 'function' || variable.state.skipUrlSync) {
                    throw new Error('Grafana не поддерживает изменение этого поля через Scenes.');
                }
                const state = variable.state;
                const value = state.isMulti ? change.values : change.values[0] ?? '';
                variable.changeValueTo(value);
            }
            if (refreshName) {
                const variable = scenes.find(item => item.state?.name === refreshName);
                if (typeof variable?.refreshOptions === 'function') await variable.refreshOptions();
            }
            return { adapter: 'scenes', variables: scenes.map(variable => projectVariable(variable, true)) };
        }
        const variables = runtime.getTemplateSrv?.().getVariables?.();
        if (!Array.isArray(variables)) return null;
        return { adapter: 'template', variables: variables.map(variable => projectVariable(variable, false)) };
    }

    async function handle(event) {
        const request = event.detail;
        if (root.name !== 'dashbridge-iframe' || stopped || busy || !request || typeof request.requestId !== 'string'
            || request.requestId.length > 100 || !['read', 'refresh', 'set'].includes(request.operation)) return;
        if (request.operation === 'set' && (typeof request.name !== 'string' || request.name.length > 200
            || !Array.isArray(request.values) || request.values.length > 5000
            || request.values.some(value => typeof value !== 'string' || value.length > 16000))) return;
        busy = true;
        try {
            const deadline = Date.now() + 20000;
            let snapshot;
            let signature = '';
            let stable = 0;
            let refreshName = request.operation === 'refresh' ? String(request.name || '').slice(0, 200) : '';
            let change = request.operation === 'set' ? { name: request.name, values: request.values } : null;
            do {
                snapshot = await inspect(refreshName, change);
                if (snapshot && change && snapshot.adapter !== 'scenes') throw new Error('Требуется загрузка панели.');
                if (snapshot) change = null;
                if (snapshot) refreshName = '';
                const next = JSON.stringify(snapshot);
                stable = next === signature ? stable + 1 : 0;
                signature = next;
                // A read does not start dependency updates: return native ready
                // values immediately. Mutations and an initially empty registry
                // still need a short settle window during Grafana startup.
                const readyRead = request.operation === 'read' && snapshot?.variables.length > 0;
                if (snapshot && !snapshot.variables.some(variable => variable.loading) && (readyRead || stable >= 3)) break;
                await pause();
            } while (!stopped && Date.now() < deadline);
            if (stopped) return;
            if (!snapshot || snapshot.variables.some(variable => variable.loading)) {
                throw new Error('Grafana ещё не подготовила переменные. Повторите запрос.');
            }
            if (snapshot.variables.length > 100 || JSON.stringify(snapshot).length > 2000000) {
                throw new Error('Список переменных превышает безопасный размер.');
            }
            document.dispatchEvent(new CustomEvent('dashbridgeVariablesResponse', {
                detail: { requestId: request.requestId, ...snapshot }
            }));
        } catch (error) {
            if (!stopped) document.dispatchEvent(new CustomEvent('dashbridgeVariablesResponse', {
                detail: { requestId: request.requestId, error: String(error.message || error).slice(0, 240) }
            }));
        } finally { busy = false; }
    }
    function stop() {
        stopped = true;
        clearTimeout(timer);
        wake?.();
        document.removeEventListener('dashbridgeVariablesRequest', handle);
        root.removeEventListener('pagehide', stop);
    }
    document.addEventListener('dashbridgeVariablesRequest', handle);
    root.addEventListener('pagehide', stop, { once: true });
    root.DashBridgeGrafanaVariablesRuntime = Object.freeze({ stop });
})(globalThis);
