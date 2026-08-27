(function initDashBridgeGrafanaCpuCapacityFilter(root) {
    'use strict';

    const HELPER_MARKER = '__dashbridgeCpuCapacityHelper';
    const HELPER_REF_PREFIX = 'DB_CPU_CAPACITY_';
    const LOAD_EXPRESSION = /\bnode_load(?:1|5|15)\s*(\{(?:[^{}"\\]|\\.|"(?:\\.|[^"\\])*")*\})/;
    const INSTANCE_MATCHER = /(?:^|,)\s*instance\s*(?:=|=~)\s*"/;

    const parseBody = body => {
        if (typeof body === 'string') {
            try { return { payload: JSON.parse(body), serialize: value => JSON.stringify(value) }; }
            catch { return null; }
        }
        if (body && typeof body === 'object' && !ArrayBuffer.isView(body)) {
            return { payload: body, serialize: value => value };
        }
        return null;
    };

    const loadSelector = expression => {
        const match = String(expression || '').match(LOAD_EXPRESSION);
        if (!match) return null;
        const content = match[1].slice(1, -1).trim();
        // Never turn an unrelated or unscoped panel into a query for every VM
        // in the datasource. The current Grafana instance selection must be
        // present in the already-expanded Load Average expression.
        if (!INSTANCE_MATCHER.test(content)) return null;
        return content;
    };

    const loadType = expression => {
        const match = String(expression || '').match(/\bnode_load(1|5|15)\b/);
        return match ? `${match[1]}m` : null;
    };

    const datasourceKey = datasource => {
        if (typeof datasource === 'string') return datasource;
        return String(datasource?.uid || datasource?.type || '');
    };

    const nextHelperRefId = used => {
        let index = 1;
        while (used.has(`${HELPER_REF_PREFIX}${index}`)) index += 1;
        const refId = `${HELPER_REF_PREFIX}${index}`;
        used.add(refId);
        return refId;
    };

    const prepareRequestBody = (body, { enabled = false, allowedRefIds = null } = {}) => {
        const parsed = parseBody(body);
        if (!enabled || !parsed || !Array.isArray(parsed.payload?.queries)) {
            return { body, changed: false, helperRefIds: [], loadRefIds: [] };
        }
        const payload = { ...parsed.payload, queries: [...parsed.payload.queries] };
        const usedRefIds = new Set(payload.queries.map(query => String(query?.refId || '')).filter(Boolean));
        const selected = payload.queries.filter(query => {
            const refId = String(query?.refId || '');
            return (!allowedRefIds || allowedRefIds.has(refId)) && loadSelector(query?.expr) !== null;
        });
        if (!selected.length) return { body, changed: false, helperRefIds: [], loadRefIds: [] };

        const helpersByScope = new Map();
        for (const query of selected) {
            const selector = loadSelector(query.expr);
            const scopeKey = `${datasourceKey(query.datasource)}\u0000${selector}`;
            let helper = helpersByScope.get(scopeKey);
            if (!helper) {
                const refId = nextHelperRefId(usedRefIds);
                helper = {
                    ...query,
                    refId,
                    expr: `count by (instance) (node_cpu_seconds_total{${selector}, mode="user"})`,
                    instant: true,
                    range: false,
                    exemplar: false,
                    legendFormat: '__dashbridge_vcpu__ {{instance}}',
                    [HELPER_MARKER]: { loadRefIds: [], loadTypes: {} }
                };
                helpersByScope.set(scopeKey, helper);
            }
            const loadRefId = String(query.refId || '');
            helper[HELPER_MARKER].loadRefIds.push(loadRefId);
            helper[HELPER_MARKER].loadTypes[loadRefId] = loadType(query.expr);
        }
        const helpers = [...helpersByScope.values()];
        payload.queries.push(...helpers);
        return {
            body: parsed.serialize(payload),
            changed: true,
            helperRefIds: helpers.map(query => query.refId),
            loadRefIds: [...new Set(helpers.flatMap(query => query[HELPER_MARKER].loadRefIds))]
        };
    };

    const readContext = body => {
        const parsed = parseBody(body);
        const queries = parsed?.payload?.queries || [];
        const helpers = queries.filter(query => query?.[HELPER_MARKER]);
        const loadQueries = queries.filter(query => loadType(query?.expr));
        const loadScopes = new Map(helpers.flatMap(helper => {
            const helperRefId = String(helper?.refId || '');
            if (!helperRefId) return [];
            return (helper[HELPER_MARKER]?.loadRefIds || [])
                .map(loadRefId => [String(loadRefId || ''), helperRefId])
                .filter(([loadRefId]) => loadRefId);
        }));
        return {
            helperRefIds: new Set(helpers.map(query => String(query.refId || '')).filter(Boolean)),
            loadRefIds: new Set([
                ...loadQueries.map(query => String(query.refId || '')).filter(Boolean),
                ...helpers.flatMap(query => query[HELPER_MARKER]?.loadRefIds || []).map(String).filter(Boolean)
            ]),
            loadTypes: new Map([
                ...loadQueries.map(query => [String(query.refId || ''), loadType(query.expr)]),
                ...helpers.flatMap(query => Object.entries(query[HELPER_MARKER]?.loadTypes || {}))
            ]),
            loadScopes
        };
    };

    const trimLoadServerNames = (data, refIds, { enabled = false, domain = '' } = {}) => {
        if (!enabled || !data?.results || !refIds.size) return;
        const escapedDomain = String(domain || '.passport.local:9182').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const domainRegex = new RegExp(`${escapedDomain}(?::\\d+)?`, 'ig');
        const trim = value => String(value).replace(domainRegex, '').replace(/:\d+$/, '');
        for (const refId of refIds) {
            for (const frame of data.results[refId]?.frames || []) {
                for (const field of frame.schema?.fields || []) {
                    for (const [key, value] of Object.entries(field.labels || {})) {
                        if (['instance', 'server', 'host', 'pod', 'node'].includes(key.toLowerCase())) {
                            field.labels[key] = trim(value);
                        }
                    }
                    if (field.type === 'time' || field.name === 'Time') continue;
                    if (field.name) field.name = trim(field.name);
                    if (field.config?.displayName) field.config.displayName = trim(field.config.displayName);
                    if (field.config?.displayNameFromDS) field.config.displayNameFromDS = trim(field.config.displayNameFromDS);
                }
            }
        }
    };

    const lastFinite = values => {
        for (let index = (values?.length || 0) - 1; index >= 0; index -= 1) {
            const value = values[index];
            if (typeof value === 'number' && Number.isFinite(value)) return value;
        }
        return null;
    };

    const fieldInstance = field => {
        const value = field?.labels?.instance;
        return typeof value === 'string' ? value.trim() : '';
    };

    const HIGHLIGHT_MARKER = '__dashbridgeThresholdHighlight';
    const CPU_CAPACITY_MARKER = '__dashbridgeCpuCapacity';
    const getFieldNames = field => [...new Set([
        field?.config?.displayName,
        field?.config?.displayNameFromDS,
        field?.name,
        ...Object.values(field?.labels || {})
    ].filter(Boolean).map(value => String(value).trim()))];

    // Keep the threshold on the original field as inert metadata. The visual
    // engine reads it after Grafana has rendered the native series and paints
    // a separate SVG overlay. Adding companion data fields is not safe: older
    // Graph/Flot panels expose them in both the legend and tooltip and inherit
    // the panel fill, even when modern `hideFrom` options are present.
    const markThresholdHighlights = (frame, candidates = []) => {
        const fields = frame?.schema?.fields || [];
        const values = frame?.data?.values || [];
        const markedFields = [...fields];
        let marked = false;
        for (const candidate of candidates) {
            if (candidate?.threshold === null || candidate?.threshold === '' || candidate?.threshold === undefined) continue;
            const threshold = Number(candidate?.threshold);
            const sourceField = fields[candidate?.index];
            const sourceValues = values[candidate?.index];
            if (!sourceField || !Array.isArray(sourceValues) || !Number.isFinite(threshold)) continue;
            const exceededSamples = sourceValues.reduce((count, value) => count
                + (typeof value === 'number' && Number.isFinite(value) && value > threshold ? 1 : 0), 0);
            if (!exceededSamples) continue;
            const sourceNames = getFieldNames(sourceField);
            markedFields[candidate.index] = {
                ...sourceField,
                labels: { ...(sourceField.labels || {}) },
                config: {
                    ...(sourceField.config || {}),
                    custom: {
                        ...(sourceField.config?.custom || {}),
                        [HIGHLIGHT_MARKER]: {
                            sourceNames,
                            threshold,
                            exceededSamples,
                            kind: candidate.highlightKind || 'legacy'
                        }
                    }
                }
            };
            marked = true;
        }
        if (!marked) return frame;
        return {
            ...frame,
            schema: { ...frame.schema, fields: markedFields }
        };
    };

    const markCpuCapacities = (frame, candidates = []) => {
        const fields = frame?.schema?.fields || [];
        const markedFields = [...fields];
        let marked = false;
        for (const candidate of candidates) {
            const capacity = Number(candidate?.capacity);
            const sourceField = fields[candidate?.index];
            if (!sourceField || !Number.isFinite(capacity) || capacity <= 0) continue;
            markedFields[candidate.index] = {
                ...sourceField,
                labels: { ...(sourceField.labels || {}) },
                config: {
                    ...(sourceField.config || {}),
                    custom: {
                        ...(sourceField.config?.custom || {}),
                        [CPU_CAPACITY_MARKER]: {
                            value: capacity,
                            instance: String(candidate.instance || fieldInstance(sourceField) || '').trim()
                        }
                    }
                }
            };
            marked = true;
        }
        return marked ? { ...frame, schema: { ...frame.schema, fields: markedFields } } : frame;
    };

    const filterResponse = (data, requestBody, {
        enabled = false, coefficient = 0.8, mode = 'max', selectedTypes = ['1m'],
        trimDomainEnabled = false, trimDomain = ''
    } = {}) => {
        const context = readContext(requestBody);
        trimLoadServerNames(data, new Set([...context.loadRefIds, ...context.helperRefIds]), {
            enabled: trimDomainEnabled,
            domain: trimDomain
        });
        const selected = new Set((Array.isArray(selectedTypes) ? selectedTypes : ['1m'])
            .filter(type => ['1m', '5m', '15m'].includes(type)));
        const metrics = {
            enabled: !!enabled,
            coefficient: Number(coefficient),
            mode: mode === 'last' ? 'last' : 'max',
            selectedTypes: [...selected],
            capacityInstances: 0,
            beforeSeries: 0,
            overloadedInstances: 0,
            missingCapacitySeries: 0,
            removedSeries: 0,
            afterSeries: 0
        };
        if (!data?.results || !context.helperRefIds.size) return { data, metrics };

        // Capacity belongs to one helper scope (datasource + selector), not to
        // an instance name globally. Different Prometheus datasources often
        // expose the same `instance`, and borrowing either capacity would make
        // the result depend on helper order.
        const capacitiesByScope = new Map();
        for (const refId of context.helperRefIds) {
            const result = data.results[refId];
            const capacities = new Map();
            for (const frame of result?.frames || []) {
                const fields = frame.schema?.fields || [];
                fields.forEach((field, index) => {
                    const instance = fieldInstance(field);
                    const value = lastFinite(frame.data?.values?.[index]);
                    if (instance && Number.isFinite(value) && value > 0) capacities.set(instance, value);
                });
            }
            capacitiesByScope.set(refId, capacities);
            // The helper response is an implementation detail and must never
            // reach Grafana's renderer or legend.
            delete data.results[refId];
        }
        metrics.capacityInstances = [...capacitiesByScope.values()]
            .reduce((total, capacities) => total + capacities.size, 0);
        const factor = Number(coefficient);
        if (!enabled || !Number.isFinite(factor) || factor <= 0 || !context.loadRefIds.size) {
            return { data, metrics: { ...metrics, invalidCoefficient: enabled && (!Number.isFinite(factor) || factor <= 0) } };
        }

        const overloaded = new Set();
        const scopedInstanceKey = (scope, instance) => scope && instance ? `${scope}\u0000${instance}` : null;
        for (const [refId, result] of Object.entries(data.results)) {
            if (!context.loadRefIds.has(String(refId))) continue;
            const loadRefId = String(refId);
            const selectedType = selected.has(context.loadTypes.get(loadRefId));
            const helperScope = context.loadScopes.get(loadRefId);
            const scopedCapacities = capacitiesByScope.get(helperScope);
            result.frames = (result.frames || []).map(frame => {
                const fields = frame.schema?.fields || [];
                const timeIndexes = fields.map((field, index) => field.type === 'time' || field.name === 'Time' ? index : -1)
                    .filter(index => index >= 0);
                if (!timeIndexes.length) return frame;
                const candidates = fields.map((field, index) => {
                    if (timeIndexes.includes(index)) return null;
                    const instance = fieldInstance(field);
                    const capacity = scopedCapacities?.get(instance);
                    const scopeKey = scopedInstanceKey(helperScope, instance);
                    const threshold = Number.isFinite(capacity) ? capacity * factor : null;
                    const values = frame.data?.values?.[index] || [];
                    let exceeded = false;
                    if (selectedType && Number.isFinite(threshold)) {
                        if (metrics.mode === 'last') {
                            const value = lastFinite(values);
                            exceeded = Number.isFinite(value) && value > threshold;
                        } else {
                            exceeded = values.some(value => typeof value === 'number' && Number.isFinite(value) && value > threshold);
                        }
                    }
                    if (scopeKey && exceeded) overloaded.add(scopeKey);
                    return {
                        index,
                        instance,
                        capacity: Number.isFinite(capacity) ? capacity : null,
                        hasCapacity: Number.isFinite(capacity),
                        selectedType,
                        threshold,
                        scopeKey
                    };
                }).filter(Boolean);
                metrics.beforeSeries += candidates.length;
                const draft = { frame, timeIndexes, candidates };
                return draft;
            });
        }
        metrics.overloadedInstances = overloaded.size;

        for (const result of Object.values(data.results)) {
            result.frames = (result.frames || []).map(item => {
                if (!item?.frame) return item;
                const keptCandidates = item.candidates.filter(candidate => {
                    if (!candidate.selectedType) return false;
                    if (!candidate.instance || !candidate.hasCapacity) {
                        metrics.missingCapacitySeries += 1;
                        return true;
                    }
                    return overloaded.has(candidate.scopeKey);
                });
                const indexes = [...item.timeIndexes, ...keptCandidates.map(candidate => candidate.index)];
                metrics.afterSeries += keptCandidates.length;
                metrics.removedSeries += item.candidates.length - keptCandidates.length;
                if (keptCandidates.length === 0) return null;
                let rebuiltFrame = {
                    ...item.frame,
                    schema: { ...item.frame.schema, fields: indexes.map(index => item.frame.schema?.fields?.[index]) },
                    data: { ...item.frame.data, values: indexes.map(index => item.frame.data?.values?.[index]) }
                };
                const rebuiltCandidates = keptCandidates.map(candidate => ({
                    index: indexes.indexOf(candidate.index),
                    threshold: candidate.threshold,
                    capacity: candidate.capacity,
                    instance: candidate.instance,
                    highlightKind: 'cpu-capacity-filter'
                }));
                rebuiltFrame = markCpuCapacities(rebuiltFrame, rebuiltCandidates);
                return markThresholdHighlights(rebuiltFrame, rebuiltCandidates);
            }).filter(Boolean);
        }
        return { data, metrics };
    };

    root.DashBridgeGrafanaCpuCapacityFilter = Object.freeze({
        HELPER_MARKER,
        HELPER_REF_PREFIX,
        loadSelector,
        loadType,
        HIGHLIGHT_MARKER,
        CPU_CAPACITY_MARKER,
        markThresholdHighlights,
        markCpuCapacities,
        trimLoadServerNames,
        prepareRequestBody,
        readContext,
        filterResponse
    });
})(globalThis);
