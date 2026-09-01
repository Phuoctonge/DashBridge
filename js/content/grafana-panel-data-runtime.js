(() => {
    'use strict';

    const create = context => {
        const {
            tools, isDashboardIframe, visualMetadata, legendSelection, getTargetPanel,
            pushBoundedDiagnosticEvent, capDiagnosticJournal, setRecentDiagnosticRecord,
            setPanelDataStatus, syncPanelDataStatusPresentation, responseSeriesFilterIsEnabled,
            syncResponseFilterPresentation, hasPersistentVisualWork,
            reapplyVisualStylesAfterDataTransform, consumeVisualStylesAfterQuery,
            registerRuntimeCleanup, isThresholdRestorePending
        } = context;

        const isQueryUrl = url => /api\/(ds|tsdb)\/query|api\/datasources\/proxy/.test(url || '');
        const getFieldText = field => [
            field.name, field.config?.displayName, field.config?.displayNameFromDS,
            ...Object.values(field.labels || {})
        ].filter(Boolean).join(' ').toLowerCase();
        const escapeKeywordRegExp = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
        const trimResponseDomainLabels = data => {
            if (!data?.results || tools.trimDomainEnabled !== true) return { data, modifiedCount: 0 };
            const suffix = String(tools.trimDomain || '.passport.local:9182');
            if (!suffix) return { data, modifiedCount: 0 };
            const pattern = new RegExp(escapeKeywordRegExp(suffix), 'ig');
            let modifiedCount = 0;
            const trim = value => {
                if (typeof value !== 'string') return value;
                const next = value.replace(pattern, '');
                if (next !== value) modifiedCount += 1;
                return next;
            };
            Object.values(data.results).forEach(result => (result.frames || []).forEach(frame => {
                if (typeof frame.schema?.name === 'string') frame.schema.name = trim(frame.schema.name);
                (frame.schema?.fields || []).forEach(field => {
                    field.name = trim(field.name);
                    if (field.config) {
                        field.config.displayName = trim(field.config.displayName);
                        field.config.displayNameFromDS = trim(field.config.displayNameFromDS);
                    }
                    Object.keys(field.labels || {}).forEach(key => { field.labels[key] = trim(field.labels[key]); });
                });
            }));
            return { data, modifiedCount };
        };
    
        // This is intentionally the same data algorithm used by the proven Popup
        // action «Инвертировать Idle → Load».  Keep it here, in MAIN world, so a
        // Dashboard card and the Popup cannot gradually acquire different rules.
        const transformCpuData = data => {
            let modifiedCount = 0;
            const idleKeyword = String(tools.idleKeyword || 'idle').toLowerCase();
            const idlePattern = new RegExp(escapeKeywordRegExp(idleKeyword), 'gi');
            if (!data?.results) return { data, modifiedCount };
            const cpuFieldHasIdle = field => {
                if (field.config?.displayName?.toLowerCase().includes(idleKeyword)) return true;
                if (field.config?.displayNameFromDS?.toLowerCase().includes(idleKeyword)) return true;
                if (field.name?.toLowerCase().includes(idleKeyword)) return true;
                return Object.entries(field.labels || {}).some(([key, value]) =>
                    !['instance', 'server', 'host', 'pod', 'node'].includes(key.toLowerCase()) &&
                    String(value).toLowerCase().includes(idleKeyword)
                );
            };
            // BUG-D fix: trimCpuServerLabel и trimCpuServerText были идентичны — оставлена одна функция.
            const trimCpuServerLabel = value => {
                if (tools.trimDomainEnabled === false) return String(value);
                const domain = String(tools.trimDomain || '.passport.local:9182').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                return String(value).replace(new RegExp(`${domain}(?::\\d+)?`, 'ig'), '');
            };
            const trimCpuServerText = trimCpuServerLabel;
    
            Object.values(data.results).forEach(result => {
                let hasIdle = false;
                (result.frames || []).forEach(frame => (frame.schema?.fields || []).forEach(field => {
                    if (cpuFieldHasIdle(field)) hasIdle = true;
                }));
                if (!hasIdle) return;
    
                (result.frames || []).forEach(frame => {
                    let fieldsToKeep = [];
                    let valuesToKeep = [];
                    (frame.schema?.fields || []).forEach((field, index) => {
                        let isMatch = false;
                        const replaceIdle = value => String(value).replace(idlePattern, 'load (calc)');
    
                        Object.entries(field.labels || {}).forEach(([key, value]) => {
                            if (['instance', 'server', 'host', 'pod', 'node'].includes(key.toLowerCase())) {
                                if (tools.trimDomainEnabled !== false) field.labels[key] = trimCpuServerLabel(value);
                                return;
                            }
                            if (String(value).toLowerCase().includes(idleKeyword)) {
                                isMatch = true;
                                field.labels[key] = replaceIdle(value);
                            }
                        });
                        if (field.config?.displayName?.toLowerCase().includes(idleKeyword)) {
                            isMatch = true;
                            field.config.displayName = trimCpuServerText(replaceIdle(field.config.displayName));
                        }
                        if (field.config?.displayNameFromDS?.toLowerCase().includes(idleKeyword)) {
                            isMatch = true;
                            field.config.displayNameFromDS = trimCpuServerText(replaceIdle(field.config.displayNameFromDS));
                        }
                        if (field.name?.toLowerCase().includes(idleKeyword)) {
                            isMatch = true;
                            field.name = trimCpuServerText(replaceIdle(field.name));
                        }
                        if (isMatch) Object.entries(field.labels || {}).forEach(([key, value]) => {
                            if (!['instance', 'server', 'host', 'pod', 'node'].includes(key.toLowerCase())) {
                                field.labels[key] = trimCpuServerText(value);
                            }
                        });
    
                        if (isMatch || field.type === 'time' || field.name === 'Time') {
                            if (isMatch) {
                                modifiedCount++;
                                const values = frame.data?.values?.[index] || [];
                                for (let i = 0; i < values.length; i++) {
                                    if (values[i] !== null && typeof values[i] === 'number') values[i] = 100 - values[i];
                                }
                            }
                            fieldsToKeep.push(field);
                            valuesToKeep.push(frame.data?.values?.[index]);
                        }
                    });
    
                    frame.schema.fields = fieldsToKeep;
                    frame.data.values = valuesToKeep;
                });
                result.frames = (result.frames || []).filter(frame => (frame.schema?.fields || []).length > 1);
            });
            return { data, modifiedCount };
        };
    
        // Same RAM conversion rules as the Popup action «Конвертировать график в
        // % Used»: correlate Total and Available/Used across Grafana query
        // results, remove the source memory frames, then add calculated frames.
        const transformMemData = data => {
            let modifiedCount = 0;
            if (!data?.results) return { data, modifiedCount, applied: false, reason: 'no-results' };
            const totalKeyword = String(tools.totalKeyword || 'total').toLowerCase();
            const availKeyword = String(tools.availKeyword || 'available').toLowerCase();
            const memCalcMode = tools.memCalcMode === 'used' || tools.memCalcMode === 'available'
                ? tools.memCalcMode
                : (availKeyword.includes('used') ? 'used' : 'available');
            const totalPattern = new RegExp(escapeKeywordRegExp(totalKeyword), 'gi');
            const availPattern = new RegExp(escapeKeywordRegExp(availKeyword), 'gi');
            const escapedDomain = String(tools.trimDomain || '.passport.local:9182').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const domainRegex = new RegExp(escapedDomain, 'i');
            const serverFrames = {};
    
            // BUG-K fix: ключ строится из того же набора источников, что и классификация поля
            // (instance > host > server > node > displayName > displayNameFromDS > name).
            // BUG-C fix: .replace(/:/g,'') заменён на точечную очистку только хвостового порта (:NNNN),
            // чтобы IP-адреса вида 10.0.0.1:9100 не склеивались в 10.0.0.19100.
            const buildServerKey = (field, fieldIndex, refId) => {
                const instance = field.labels?.instance || field.labels?.host || field.labels?.server || field.labels?.node || '';
                const display = field.config?.displayName || field.config?.displayNameFromDS || field.name || '';
                const rawServer = String(instance || display)
                    .replace(totalPattern, '')
                    .replace(availPattern, '');
                // Удаляем суффикс домена, затем только хвостовой порт (:1234) — не все двоеточия.
                const trimmed = tools.trimDomainEnabled === false
                    ? rawServer
                    : rawServer.replace(domainRegex, '').replace(/:\d+$/, '');
                return trimmed.trim() || `unknown_server_${refId}_${fieldIndex}`;
            };
    
            Object.entries(data.results).forEach(([refId, result]) => (result.frames || []).forEach(frame => {
                const fields = frame.schema?.fields || [];
                fields.forEach((field, fieldIndex) => {
                    const lowerName = getFieldText(field);
                    const isTotal = lowerName.includes(totalKeyword);
                    const isAvail = lowerName.includes(availKeyword);
                    if (!isTotal && !isAvail) return;
                    const server = buildServerKey(field, fieldIndex, refId);
                    const item = serverFrames[server] || (serverFrames[server] = {
                        timeField: null, totalField: null, availField: null, originalRefId: refId
                    });
                    const timeIndex = fields.findIndex(candidate => candidate.type === 'time' || candidate.name === 'Time');
                    if (timeIndex >= 0 && !item.timeField) {
                        item.timeField = { field: fields[timeIndex], values: frame.data.values[timeIndex] };
                    }
                    if (isTotal && !item.totalField) item.totalField = { field, values: frame.data.values[fieldIndex] };
                    if (isAvail && !item.availField) item.availField = { field, values: frame.data.values[fieldIndex] };
                });
            }));
    
            const memoryPairs = Object.values(serverFrames);
            if (!memoryPairs.length) return { data, modifiedCount, applied: false, reason: 'no-memory-series' };
            const incompletePair = memoryPairs.some(item => !item.timeField || !item.totalField || !item.availField
                || typeof item.timeField.values?.map !== 'function'
                || !item.totalField.values || !item.availField.values);
            if (incompletePair) return { data, modifiedCount, applied: false, reason: 'incomplete-pair' };
    
            Object.values(data.results).forEach(result => {
                result.frames = (result.frames || []).filter(frame => !(frame.schema?.fields || []).some(field => {
                    const text = getFieldText(field);
                    return text.includes(totalKeyword) || text.includes(availKeyword) || /\b(used|available|total|free)\b/i.test(text);
                }));
            });
    
            Object.entries(serverFrames).forEach(([server, item]) => {
                if (!item.timeField || !item.totalField || !item.availField) return;
                const secondMetricIsUsed = memCalcMode === 'used';
                const values = item.timeField.values.map((_, index) => {
                    const total = item.totalField.values[index];
                    const available = item.availField.values[index];
                    if (total === null || available === null || typeof total !== 'number' || typeof available !== 'number' || total <= 0) return null;
                    return (secondMetricIsUsed ? available / total : (total - available) / total) * 100;
                });
                modifiedCount++;
                const field = JSON.parse(JSON.stringify(item.availField.field));
                field.name = `${server} Used % (calc)`;
                field.config = { ...(field.config || {}), displayName: field.name, unit: 'percent' };
                delete field.config.min;
                delete field.config.max;
                Object.keys(field.labels || {}).forEach(key => {
                    if (!['instance', 'server', 'host', 'pod', 'node'].includes(key.toLowerCase())) field.labels[key] = field.name;
                });
                data.results[item.originalRefId]?.frames.push({
                    schema: { name: server, refId: item.originalRefId, meta: {}, fields: [item.timeField.field, field] },
                    data: { values: [item.timeField.values, values] }
                });
            });
            return { data, modifiedCount, applied: true, reason: 'converted' };
        };
    
        // A calculated RAM field carries unit=percent. Some Grafana renderers
        // retain that field config when the next query restores the native Total /
        // Available series. Values are then bytes again but are rendered as huge
        // percentages. Explicitly restore the byte unit on memory source fields.
        const restoreMemByteUnit = data => {
            let modifiedCount = 0;
            if (!data?.results) return { data, modifiedCount };
            const memoryKeywords = [
                String(tools.totalKeyword || 'total').toLowerCase(),
                String(tools.availKeyword || 'available').toLowerCase(),
                'used', 'free', 'cached', 'buffers'
            ].filter(Boolean);
            Object.values(data.results).forEach(result => (result.frames || []).forEach(frame => {
                (frame.schema?.fields || []).forEach((field, fieldIndex) => {
                    if (field.type === 'time' || field.name === 'Time') return;
                    const values = frame.data?.values?.[fieldIndex] || [];
                    const numeric = field.type === 'number'
                        || values.some(value => typeof value === 'number' && Number.isFinite(value));
                    if (!numeric || !memoryKeywords.some(keyword => getFieldText(field).includes(keyword))) return;
                    field.config = { ...(field.config || {}), unit: 'bytes' };
                    modifiedCount += 1;
                });
            }));
            return { data, modifiedCount };
        };
    
        const { getResponseTableFrameShape } = window.DashBridgeGrafanaTableReport;
    
        const targetPanelUsesTable = () => {
            const panel = window.DashBridgeGrafanaDom?.outerPanel?.(getTargetPanel()) || getTargetPanel();
            if (!panel || panel.querySelector?.('.graph-panel__chart, .uplot, .u-wrap')) return false;
            return Array.from(panel.querySelectorAll?.('th, [role="columnheader"]') || [])
                .some(header => /^(?:metric|value|метрика|значение)$/iu.test(String(header.textContent || '').trim()));
        };
    
        const collectResponseTableRecords = data => {
            const records = [];
            const MAX_TABLE_RECORDS = 5000;
            outer: for (const result of Object.values(data?.results || {})) {
                for (const frame of result.frames || []) {
                    const shape = getResponseTableFrameShape(frame);
                    if (!shape || (shape.timeIndexes.length && !targetPanelUsesTable())) continue;
                    for (let index = 0; index < shape.rowCount; index++) {
                        if (records.length >= MAX_TABLE_RECORDS) break outer;
                    const name = String(shape.columns[shape.nameIndex]?.[index] ?? '').trim();
                    const value = Number(shape.columns[shape.valueIndex]?.[index]);
                    if (name && Number.isFinite(value)) records.push({ name: name.substring(0, 500), value });
                    }
                }
            }
            return records;
        };
    
        // Keeps only chart fields or table rows that reached the requested threshold. This runs
        // after CPU/RAM calculations, so their derived values are evaluated.
        //
        // The safety floor is deliberately response-global, not per frame. Grafana
        // often returns one numeric series per frame; retaining a fallback in every
        // such frame would silently retain every series and make filtering a no-op.
        const filterSeriesByThreshold = data => {
            const metrics = {
                enabled: !!tools.seriesQueryFilterEnabled,
                beforeSeries: 0,
                thresholdMatchedSeries: 0,
                safetyRetainedSeries: 0,
                removedSeries: 0,
                afterSeries: 0,
            };
            if (!data?.results || !tools.seriesQueryFilterEnabled) return { data, metrics };
            const rawThreshold = tools.seriesQueryFilterRawValue;
            const hasRawThreshold = rawThreshold !== null && rawThreshold !== undefined && rawThreshold !== ''
                && Number.isFinite(Number(rawThreshold));
            const threshold = hasRawThreshold
                ? Number(rawThreshold)
                : Number(tools.seriesQueryFilterValue);
            if (!Number.isFinite(threshold)) return { data, metrics: { ...metrics, invalidThreshold: true } };
            const mode = tools.seriesQueryFilterMode === 'last' ? 'last' : 'max';
            const getEvaluationValue = values => {
                if (mode === 'last') {
                    for (let index = (values?.length || 0) - 1; index >= 0; index--) {
                        const value = values[index];
                        if (typeof value === 'number' && Number.isFinite(value)) return value;
                    }
                    return Number.NEGATIVE_INFINITY;
                }
                return (values || []).reduce((maximum, value) => (
                    typeof value === 'number' && Number.isFinite(value) && value > maximum ? value : maximum
                ), Number.NEGATIVE_INFINITY);
            };
            const isSeriesAboveThreshold = value => {
                return value > threshold;
            };
            const timeSeriesFrames = [];
            const tablePanel = targetPanelUsesTable();
    
            Object.values(data.results).forEach(result => {
                result.frames = (result.frames || []).map(frame => {
                    const fields = frame.schema?.fields || [];
                    const timeIndexes = fields.map((field, index) => field.type === 'time' || field.name === 'Time' ? index : -1)
                        .filter(index => index >= 0);
                    const tableShape = getResponseTableFrameShape(frame);
                    if (tableShape && (!tableShape.timeIndexes.length || tablePanel)) {
                        const keptRowIndexes = [];
                        for (let index = 0; index < tableShape.rowCount; index++) {
                            const value = Number(tableShape.columns[tableShape.valueIndex]?.[index]);
                            metrics.beforeSeries += 1;
                            if (Number.isFinite(value) && isSeriesAboveThreshold(value)) {
                                metrics.thresholdMatchedSeries += 1;
                                keptRowIndexes.push(index);
                            }
                        }
                        const draft = { frame, tableShape, keptRowIndexes };
                        timeSeriesFrames.push(draft);
                        return draft;
                    }
                    // Variable query responses are not time series.
                    if (!timeIndexes.length) return frame;
                    const passthroughIndexes = [];
                    const candidates = fields.map((field, index) => {
                        if (timeIndexes.includes(index)) return null;
                        const values = frame.data?.values?.[index] || [];
                        const numeric = field?.type === 'number' || (field?.type == null
                            && values.some(value => typeof value === 'number' && Number.isFinite(value)));
                        if (!numeric) {
                            passthroughIndexes.push(index);
                            return null;
                        }
                        const evaluationValue = getEvaluationValue(values);
                        return { index, evaluationValue, matched: isSeriesAboveThreshold(evaluationValue) };
                    }).filter(Boolean);
                    metrics.beforeSeries += candidates.length;
                    metrics.thresholdMatchedSeries += candidates.filter(candidate => candidate.matched).length;
                    const keptIndexes = [...timeIndexes, ...passthroughIndexes,
                        ...candidates.filter(candidate => candidate.matched).map(candidate => candidate.index)];
                    const draft = { frame, timeIndexes, keptIndexes, candidates };
                    timeSeriesFrames.push(draft);
                    return draft;
                });
            });
    
            // An empty result is a valid outcome: no series exceeded the configured
            // threshold. Grafana will render No data, and report collection uses the
            // response metadata below to distinguish it from a datasource failure.
    
            Object.values(data.results).forEach(result => {
                result.frames = (result.frames || [])
                    // Drop time-only drafts before turning them back into Grafana frames.
                    // Filtering after conversion would see no `.frame` property and retain
                    // every frame, preventing a legitimate empty filtered result.
                    .filter(item => !item?.frame || (item.tableShape
                        ? item.keptRowIndexes.length > 0
                        : item.keptIndexes.length > item.timeIndexes.length))
                    .map(item => {
                        if (!item?.frame) return item;
                        if (item.tableShape) {
                            return {
                                ...item.frame,
                                schema: { ...item.frame.schema, fields: [...item.frame.schema.fields] },
                                data: {
                                    ...item.frame.data,
                                    values: (item.frame.data?.values || []).map(values => item.keptRowIndexes.map(index => values?.[index]))
                                }
                            };
                        }
                        const indexes = [...new Set(item.keptIndexes)].sort((left, right) => left - right);
                        const rebuiltFrame = {
                            ...item.frame,
                            schema: { ...item.frame.schema, fields: indexes.map(index => item.frame.schema?.fields?.[index]) },
                            data: { ...item.frame.data, values: indexes.map(index => item.frame.data?.values?.[index]) }
                        };
                        const highlightCandidates = item.candidates
                            .filter(candidate => indexes.includes(candidate.index))
                            .map(candidate => ({
                                index: indexes.indexOf(candidate.index),
                                threshold,
                                highlightKind: 'series-query-filter'
                            }));
                        return window.DashBridgeGrafanaCpuCapacityFilter?.markThresholdHighlights?.(
                            rebuiltFrame,
                            highlightCandidates
                        ) || rebuiltFrame;
                    });
            });
            metrics.afterSeries = metrics.thresholdMatchedSeries + metrics.safetyRetainedSeries;
            metrics.removedSeries = Math.max(0, metrics.beforeSeries - metrics.afterSeries);
            return { data, metrics };
        };
    
        const getFieldLegendNames = field => [...new Set([
            ...(field.config?.custom?.__dashbridgeThresholdHighlight?.sourceNames || []),
            field.config?.displayName,
            field.config?.displayNameFromDS,
            field.name,
            ...Object.values(field.labels || {})
        ].filter(Boolean).map(value => String(value).trim()))];
    
        // In newer Grafana data frames every value field can simply be named
        // "Value". The human-visible series name then belongs to the frame.
        const getFrameLegendNames = (frame, field) => [...new Set([
            ...getFieldLegendNames(field),
            frame.schema?.name,
            frame.schema?.refId
        ].filter(Boolean).map(value => String(value).trim()))];
    
        const collectResponseSeriesNames = data => {
            const generic = value => /^(?:value|series|metric|значение|серия|метрика)$/iu
                .test(String(value || '').trim());
            const names = [];
            outer: for (const result of Object.values(data?.results || {})) {
                for (const frame of result.frames || []) {
                    for (const field of frame.schema?.fields || []) {
                        if (field.type === 'time' || field.name === 'Time') continue;
                        if (names.length >= 20_000) break outer;
                        const candidates = [
                            field.config?.displayNameFromDS,
                            field.config?.displayName,
                            frame.schema?.name,
                            ...Object.values(field.labels || {}),
                            field.name,
                            frame.schema?.refId
                        ].map(value => String(value || '').trim()).filter(Boolean);
                        names.push(candidates.find(name => !generic(name)) || candidates[0] || '');
                    }
                }
            }
            return names.filter(Boolean);
        };
    
        const collectResponseFilterVisibleNames = data => {
            const names = new Set();
            Object.values(data?.results || {}).forEach(result => {
                for (const frame of result.frames || []) {
                    for (const field of frame.schema?.fields || []) {
                        if (field.type === 'time' || field.name === 'Time') continue;
                        [
                            field.config?.displayName,
                            field.config?.displayNameFromDS,
                            field.name,
                            frame.schema?.name,
                            ...Object.entries(field.labels || {})
                                .filter(([key]) => ['instance', 'server', 'host', 'pod', 'node'].includes(key.toLowerCase()))
                                .map(([, value]) => value)
                        ].filter(Boolean).forEach(value => names.add(String(value).trim()));
                    }
                }
            });
            return [...names].filter(Boolean);
        };
    
        const collectThresholdHighlightRules = data => {
            const rules = [];
            const seen = new Set();
            Object.values(data?.results || {}).forEach(result => {
                for (const frame of result.frames || []) {
                    for (const field of frame.schema?.fields || []) {
                        const marker = field.config?.custom?.__dashbridgeThresholdHighlight;
                        if (!marker || !Number.isFinite(Number(marker.threshold))) continue;
                        const kind = marker.kind || 'legacy';
                        const sourceNames = [...new Set([
                            ...(marker.sourceNames || []),
                            ...getFrameLegendNames(frame, field)
                        ].filter(Boolean).map(value => String(value).trim()))];
                        const key = `${kind}\u0000${Number(marker.threshold)}\u0000${sourceNames.join('\u0000')}`;
                        if (seen.has(key)) continue;
                        seen.add(key);
                        rules.push({ threshold: Number(marker.threshold), sourceNames, kind });
                    }
                }
            });
            return rules;
        };
    
        const collectCpuCapacityEntries = data => {
            const entries = [];
            const seen = new Set();
            Object.values(data?.results || {}).forEach(result => {
                for (const frame of result.frames || []) {
                    for (const field of frame.schema?.fields || []) {
                        const marker = field.config?.custom?.__dashbridgeCpuCapacity;
                        const value = Number(marker?.value);
                        if (!Number.isFinite(value) || value <= 0) continue;
                        const sourceNames = [...new Set([
                            marker.instance,
                            ...getFrameLegendNames(frame, field)
                        ].filter(Boolean).map(name => String(name).trim()))];
                        const key = `${value}\u0000${sourceNames.join('\u0000')}`;
                        if (seen.has(key)) continue;
                        seen.add(key);
                        entries.push({ value, sourceNames });
                    }
                }
            });
            return entries;
        };
    
        // Complete-hide is the only legend mode that removes series from the
        // Grafana query response. Grafana can then assign its own compact palette
        // to the remaining fields on the next render.
        const filterLegendData = data => {
            // Frames without a time field belong to variable queries and remain
            // unchanged; the shared selector only filters chart data frames.
            return legendSelection.filterDataFrames(data, tools, getFrameLegendNames);
        };
    
        const hasSourceSeriesFilterScope = refIds => isDashboardIframe || refIds instanceof Set && refIds.size > 0;
        const hasDataTransform = () => !!tools.invertIdle || !!tools.convertMemToUsed || !!tools.forceMemByteUnit
            || tools.trimDomainEnabled === true || !!tools.seriesQueryFilterEnabled
            || !!tools.cpuCapacityFilterEnabled
            || legendSelection.isCompleteHideActive(tools);
    
        const getRequestQueries = requestBody => {
            try {
                const payload = typeof requestBody === 'string' ? JSON.parse(requestBody) : requestBody;
                return Array.isArray(payload?.queries) ? payload.queries : [];
            } catch {
                return [];
            }
        };
        const isTargetPanelView = () => {
            const viewPanel = new URL(location.href).searchParams.get('viewPanel');
            if (!viewPanel) return false;
            // On a hard navigation Grafana can issue the View panel's first query
            // before DashBridge receives a command carrying targetPanelId. The
            // route itself still has an unambiguous single-panel scope.
            if (!tools.targetPanelId) return true;
            return `panel-${String(viewPanel).replace(/^panel-/, '')}`
                === `panel-${String(tools.targetPanelId).replace(/^panel-/, '')}`;
        };
        const getTargetQueryRefIds = requestBody => {
            if (isDashboardIframe) return null;
            const signatures = new Set(tools.targetQuerySignatures || []);
            const queries = getRequestQueries(requestBody);
            // Grafana's View route renders only the requested panel. It may start
            // the first datasource request before the dashboard definition has
            // been read, so the route's panel id is the strongest available scope.
            if (isTargetPanelView()) {
                return new Set(queries.map(query => String(query.refId || '')).filter(Boolean));
            }
            if (!signatures.size) return new Set();
            const getQueryScopeSignature = window.DashBridgeGrafanaVisualEngine?.getQueryScopeSignature;
            const scopeSignatures = new Set([...signatures].map(signature => {
                try { return getQueryScopeSignature?.(JSON.parse(signature)) || ''; } catch { return ''; }
            }).filter(Boolean));
            const configuredQueries = [...signatures].map(signature => {
                try { return JSON.parse(signature); } catch { return null; }
            }).filter(Boolean);
            try {
                const candidates = queries.map(query => ({
                    raw: query,
                    refId: String(query.refId || ''),
                    alias: query.alias || '',
                    signature: window.DashBridgeGrafanaVisualEngine?.getQuerySignature?.(query) || '',
                    scopeSignature: getQueryScopeSignature?.(query) || '',
                }));
                const matched = candidates.filter(query => signatures.has(query.signature)
                    || scopeSignatures.has(query.scopeSignature)
                    || configuredQueries.some(configured => window.DashBridgeGrafanaPanelDefinition
                        ?.queryMatchesConfiguredTarget?.(configured, query.raw)));
                return new Set(matched.map(query => query.refId).filter(Boolean));
            } catch {
                return new Set();
            }
        };
        const getAnalysisQueryRefIds = (requestBody, signatures) => {
            if (isDashboardIframe) return null;
            const queries = getRequestQueries(requestBody);
            const configuredSignatures = new Set(signatures || []);
            if (!configuredSignatures.size) return new Set();
            const getQueryScopeSignature = window.DashBridgeGrafanaVisualEngine?.getQueryScopeSignature;
            const scopeSignatures = new Set([...configuredSignatures].map(signature => {
                try { return getQueryScopeSignature?.(JSON.parse(signature)) || ''; } catch { return ''; }
            }).filter(Boolean));
            const configuredQueries = [...configuredSignatures].map(signature => {
                try { return JSON.parse(signature); } catch { return null; }
            }).filter(Boolean);
            try {
                return new Set(queries.filter(query => {
                    const signature = window.DashBridgeGrafanaVisualEngine?.getQuerySignature?.(query) || '';
                    const scopeSignature = getQueryScopeSignature?.(query) || '';
                    return configuredSignatures.has(signature) || scopeSignatures.has(scopeSignature)
                        || configuredQueries.some(configured => window.DashBridgeGrafanaPanelDefinition
                            ?.queryMatchesConfiguredTarget?.(configured, query));
                }).map(query => String(query.refId || '')).filter(Boolean));
            } catch {
                return new Set();
            }
        };
        const observePanelAnalysisResponse = (session, data, requestBody, requestStartedAt) => {
            try {
                if (!session || session !== window.__dashbridgePanelAnalysisCaptureSession || session.cancelled
                    || requestStartedAt < session.acceptAfter) return;
                const targetRefIds = getAnalysisQueryRefIds(requestBody, session.signatures);
                if (targetRefIds !== null && !targetRefIds.size) return;
                const snapshot = window.DashBridgeGrafanaPanelAnalysis?.analyzeResponse?.({
                    type: session.type,
                    data,
                    targetRefIds,
                    settings: session.settings
                });
                if (snapshot?.ok) session.onSnapshot?.(snapshot);
            } catch {
                // Analysis is observational: malformed datasource frames must never
                // prevent the established CPU/RAM transform from consuming a response.
            }
        };
        const panelAnalysisRequestMatches = (session, requestBody, requestStartedAt) => {
            if (!session || session !== window.__dashbridgePanelAnalysisCaptureSession || session.cancelled
                || requestStartedAt < session.acceptAfter) return false;
            const targetRefIds = getAnalysisQueryRefIds(requestBody, session.signatures);
            return targetRefIds === null || targetRefIds.size > 0;
        };
        const createResponseFilterWorkspace = (data, targetRefIds, helperRefIds = new Set()) => {
            const privateHelperRefIds = new Set(helperRefIds || []);
            if (targetRefIds === null) {
                return { data, isolated: false, helperRefIds: privateHelperRefIds };
            }
            const includedRefIds = new Set([...targetRefIds, ...privateHelperRefIds]);
            return {
                data: {
                    ...data,
                    results: Object.fromEntries(Object.entries(data?.results || {})
                        .filter(([refId]) => includedRefIds.has(String(refId))))
                },
                isolated: true,
                helperRefIds: privateHelperRefIds
            };
        };
        const commitResponseFilterWorkspace = (target, workspace) => {
            if (!workspace?.isolated) return target;
            workspace.helperRefIds.forEach(refId => delete target.results?.[refId]);
            Object.assign(target.results, workspace.data.results);
            return target;
        };
    
        const prepareCpuCapacityRequestBody = requestBody => {
            const capacityFilter = window.DashBridgeGrafanaCpuCapacityFilter;
            if (!capacityFilter || !tools.cpuCapacityFilterEnabled) return { body: requestBody, changed: false };
            const allowedRefIds = isDashboardIframe ? null : getTargetQueryRefIds(requestBody);
            if (!isDashboardIframe && !allowedRefIds.size) return { body: requestBody, changed: false };
            return capacityFilter.prepareRequestBody(requestBody, { enabled: true, allowedRefIds });
        };
    
        const replaceFetchBody = (args, body) => {
            const [input, init] = args;
            if (typeof Request !== 'undefined' && input instanceof Request) {
                return [new Request(input, { ...(init || {}), body })];
            }
            return [input, { ...(init || {}), body }];
        };
    
        const getTargetLegendRefIds = data => {
            const targetNames = new Set((tools.targetLegendSeries || []).map(name => String(name).trim()).filter(Boolean));
            if (!targetNames.size) return new Set();
            const results = Object.entries(data?.results || {}).map(([refId, result]) => ({
                refId: String(refId),
                fields: (result.frames || []).flatMap(frame => (frame.schema?.fields || []).map(field => ({
                    fieldNames: getFieldLegendNames(field)
                })))
            }));
            const matched = results.filter(result => result.fields.some(field =>
                field.fieldNames.some(name => targetNames.has(name))
            ));
            return new Set(matched.map(result => result.refId));
        };
    
        const calculatedTitleOriginalText = new WeakMap();
        const markCalculatedTitle = () => {
            const suffix = ' calculated';
            const root = getTargetPanel();
            const title = root.querySelector('[class*="panel-title" i], .panel-title-text, [data-testid*="header" i] h2, [data-testid*="header" i] h6, .panel-header h2, .panel-header h6');
            if (!title) return;
            const text = (title.textContent || '').trim();
            if (tools.invertIdle || tools.convertMemToUsed || tools.cpuCapacityFilterEnabled) {
                if (!calculatedTitleOriginalText.has(title)) {
                    calculatedTitleOriginalText.set(title, text.endsWith(suffix) ? text.slice(0, -suffix.length) : text);
                }
                const originalText = calculatedTitleOriginalText.get(title);
                if (originalText && text !== `${originalText}${suffix}`) title.textContent = `${originalText}${suffix}`;
                return;
            }
            const originalText = calculatedTitleOriginalText.get(title);
            if (originalText !== undefined) {
                title.textContent = originalText;
                calculatedTitleOriginalText.delete(title);
            } else if (text.endsWith(suffix)) {
                title.textContent = text.slice(0, -suffix.length);
            }
        };
    
        let calculatedTitleFrame = 0;
        const scheduleCalculatedTitleSync = () => {
            if (calculatedTitleFrame) return;
            calculatedTitleFrame = requestAnimationFrame(() => {
                calculatedTitleFrame = 0;
                markCalculatedTitle();
                syncPanelDataStatusPresentation();
            });
        };
        const observeCalculatedTitle = () => {
            const observerRequired = !!tools.invertIdle || !!tools.convertMemToUsed
                || !!tools.cpuCapacityFilterEnabled || !!tools.seriesQueryFilterEnabled;
            // BUG-B fix: проверяем не только наличие флага, но и активность observer'а.
            // После suspend/resume браузер может разорвать соединение — тогда observer надо пересоздать.
            const existing = window.__dashbridgeCalculatedTitleObserver;
            if (!observerRequired) {
                existing?.disconnect();
                window.__dashbridgeCalculatedTitleObserver = null;
                if (calculatedTitleFrame) cancelAnimationFrame(calculatedTitleFrame);
                calculatedTitleFrame = 0;
                return;
            }
            if (existing && existing._dashbridgeActive) return;
            existing?.disconnect();
            const obs = new MutationObserver(scheduleCalculatedTitleSync);
            obs._dashbridgeActive = true;
            obs.observe(document.documentElement, { subtree: true, childList: true });
            window.__dashbridgeCalculatedTitleObserver = obs;
        };
        registerRuntimeCleanup(() => {
            if (calculatedTitleFrame) cancelAnimationFrame(calculatedTitleFrame);
            calculatedTitleFrame = 0;
        });
    
        // Monkey-patching (перехват сети): мы подменяем оригинальные window.fetch и XMLHttpRequest.
        // Это позволяет нам "на лету" перехватывать JSON-ответы от сервера Grafana (/api/ds/query) 
        // и изменять сырые метрики (например, инвертировать CPU idle в CPU used или считать RAM) 
        // до того, как они попадут во внутренний стейт дашборда.
        const installDataInterceptor = () => {
            if (window.__dashbridgeCardDataInterceptor) return;
            window.__dashbridgeCardDataInterceptor = true;
            const diagnostics = window.__dashbridgeDataInterceptorDiagnostic = window.__dashbridgeDataInterceptorDiagnostic || {
                queryResponses: 0, transformed: 0, exactMatches: 0, legendFallbackMatches: 0,
                unmatched: 0, sourceFilterRuns: 0, last: null,
                nextEventId: 0, activeRequests: 0, events: []
            };
            // Keep this journal compact and JSON-serializable: E2E needs causal
            // request evidence, not request/response payloads or DOM references.
            diagnostics.nextEventId = Number(diagnostics.nextEventId) || 0;
            diagnostics.activeRequests = Number(diagnostics.activeRequests) || 0;
            diagnostics.events = Array.isArray(diagnostics.events) ? diagnostics.events : [];
            capDiagnosticJournal(diagnostics, 500);
            const payloadArchive = window.__dashbridgeDataInterceptorArchive
                || (window.__dashbridgeDataInterceptorArchive = {
                    schema: 'dashbridge-e2e-network-payload-archive/v1',
                    startedAt: Date.now(),
                    requests: {},
                    responses: {},
                    limits: { requests: 100, observationsPerResponse: 8, payloadCharacters: 8192, fullPayloadBudget: 2 * 1024 * 1024 },
                    stats: { storedFullPayloadCharacters: 0, truncatedPayloads: 0, droppedRequests: 0, droppedObservations: 0 },
                });
            payloadArchive.requests ||= {};
            payloadArchive.responses ||= {};
            payloadArchive.limits ||= { requests: 100, observationsPerResponse: 8, payloadCharacters: 8192, fullPayloadBudget: 2 * 1024 * 1024 };
            payloadArchive.stats ||= { storedFullPayloadCharacters: 0, truncatedPayloads: 0, droppedRequests: 0, droppedObservations: 0 };
            const archiveEnabled = () => window.__dashbridgeE2EDiagnostics?.installed === true;
            const fullPayloadEvidenceEnabled = () => window.__dashbridgeE2EDiagnostics?.fullPayloadEvidence === true;
            const hashPayload = text => {
                let value = 2166136261;
                for (let index = 0; index < text.length; index += 1) {
                    value = Math.imul(value ^ text.charCodeAt(index), 16777619);
                }
                return `fnv1a-${(value >>> 0).toString(16)}`;
            };
            const serializePayload = value => {
                try {
                    const text = typeof value === 'string' ? value : JSON.stringify(value);
                    const maxCharacters = Number(payloadArchive.limits.payloadCharacters) || 8192;
                    const remainingBudget = Math.max(0, (Number(payloadArchive.limits.fullPayloadBudget) || 0)
                        - (Number(payloadArchive.stats.storedFullPayloadCharacters) || 0));
                    const retainFull = fullPayloadEvidenceEnabled() && text.length <= remainingBudget;
                    let parsed = null;
                    if (retainFull) {
                        parsed = value;
                        if (typeof value === 'string') {
                            try { parsed = JSON.parse(value); } catch (_) { parsed = value; }
                        }
                        payloadArchive.stats.storedFullPayloadCharacters += text.length;
                    } else if (text.length) {
                        payloadArchive.stats.truncatedPayloads += 1;
                    }
                    return {
                        value: parsed,
                        textBytes: text.length,
                        hash: hashPayload(text),
                        truncated: !retainFull,
                        sample: retainFull ? null : {
                            first: text.slice(0, Math.floor(maxCharacters / 2)),
                            last: text.slice(-Math.ceil(maxCharacters / 2)),
                        },
                    };
                } catch (error) {
                    return { value: null, textBytes: null, hash: null, error: error?.message || String(error) };
                }
            };
            const archiveRequest = (requestId, transport, url, body) => {
                if (!archiveEnabled()) return;
                const before = Object.keys(payloadArchive.requests).length;
                setRecentDiagnosticRecord(payloadArchive.requests, requestId, {
                    at: Date.now(), requestId, transport, url: String(url || ''),
                    body: serializePayload(body ?? null),
                }, Number(payloadArchive.limits.requests) || 100);
                if (before >= (Number(payloadArchive.limits.requests) || 100)) payloadArchive.stats.droppedRequests += 1;
            };
            const archiveResponse = (requestId, stage, data, details = {}) => {
                if (!archiveEnabled()) return;
                const record = payloadArchive.responses[requestId]
                    || setRecentDiagnosticRecord(payloadArchive.responses, requestId, { requestId, observations: [] }, Number(payloadArchive.limits.requests) || 100);
                record.observations.push({ at: Date.now(), stage, payload: serializePayload(data), ...details });
                const observationLimit = Number(payloadArchive.limits.observationsPerResponse) || 8;
                if (record.observations.length > observationLimit) {
                    const removed = record.observations.length - observationLimit;
                    record.observations.splice(0, removed);
                    payloadArchive.stats.droppedObservations += removed;
                }
            };
            const pushEvent = (stage, details = {}) => {
                const event = { id: ++diagnostics.nextEventId, at: Date.now(), stage, ...details };
                pushBoundedDiagnosticEvent(diagnostics, event, 500);
                return event;
            };
            const reportCycle = { active: new Set(), failures: [] };
            const beginRequest = (transport, url) => {
                const requestId = `query_${Date.now()}_${diagnostics.nextEventId + 1}`;
                if (!reportCycle.active.size) {
                    reportCycle.failures = [];
                    visualMetadata.responseFilterEmptyIsNormal = false;
                    if (isDashboardIframe) setPanelDataStatus('loading');
                }
                reportCycle.active.add(requestId);
                diagnostics.activeRequests = reportCycle.active.size;
                pushEvent('request-start', { requestId, transport, url: String(url || ''), activeRequests: diagnostics.activeRequests });
                return requestId;
            };
            const completeRequest = (requestId, transport, outcome, details = {}) => {
                if (!reportCycle.active.has(requestId)) return;
                reportCycle.active.delete(requestId);
                diagnostics.activeRequests = reportCycle.active.size;
                if (['http-error', 'network-error', 'decode-error'].includes(outcome)) {
                    visualMetadata.responseFilterEmptyIsNormal = false;
                    reportCycle.failures.push({ outcome, ...details });
                }
                pushEvent('request-complete', { requestId, transport, outcome, activeRequests: diagnostics.activeRequests });
                if (reportCycle.active.size) return;
                const failure = reportCycle.failures[0] || null;
                if (failure?.outcome === 'http-error') setPanelDataStatus('http_error', { httpStatus: failure.httpStatus });
                else if (failure?.outcome === 'network-error') setPanelDataStatus('network_error');
                else if (failure?.outcome === 'decode-error') setPanelDataStatus('decode_error');
                else if (visualMetadata.responseFilterEmptyIsNormal) setPanelDataStatus('filtered_empty');
                // A transform determines data/empty from its scoped response. Do
                // not overwrite that result after the final parallel request.
                else if (outcome === 'transformed') { /* status already set by transform */ }
                else if (outcome === 'aborted') setPanelDataStatus('aborted');
                else setPanelDataStatus('unknown');
                window.dispatchEvent(new Event('dashbridgePanelDataSettled'));
            };
            const decodeNativeFetchResponse = response => response.clone().json();
            const transform = (data, requestBody, request) => {
                archiveResponse(request.requestId, 'decoded-before-transform', data, { transport: request.transport });
                if (!data?.results) {
                    visualMetadata.responseFilterEmptyIsNormal = false;
                    setPanelDataStatus('decode_error');
                    pushEvent('decode-error', { ...request, reason: 'response has no results' });
                    archiveResponse(request.requestId, 'returned-without-results', data, { reason: 'response has no results' });
                    return data;
                }
                diagnostics.queryResponses += 1;
                const exactTargetRefIds = getTargetQueryRefIds(requestBody);
                let targetRefIds = exactTargetRefIds;
                let scope = exactTargetRefIds === null ? 'iframe' : exactTargetRefIds.size ? 'query-signature' : 'none';
                if (!isDashboardIframe && !targetRefIds.size) {
                    targetRefIds = getTargetLegendRefIds(data);
                    if (targetRefIds.size) scope = 'legend-fallback';
                }
                const resultRefIds = Object.keys(data.results || {});
                // A normal Grafana dashboard has many panels sharing the same
                // datasource endpoint. Never alter a response until it matches
                // the selected panel's saved query signature.
                if (!isDashboardIframe && !targetRefIds.size) {
                    diagnostics.unmatched += 1;
                    diagnostics.last = { at: Date.now(), scope, resultRefIds, targetRefIds: [] };
                    pushEvent('scope-mismatch', { ...request, scope, resultRefIds, targetRefIds: [] });
                    archiveResponse(request.requestId, 'returned-scope-mismatch', data, { scope, resultRefIds });
                    return data;
                }
                if (scope === 'query-signature') diagnostics.exactMatches += 1;
                if (scope === 'legend-fallback') diagnostics.legendFallbackMatches += 1;
                const capacityFilter = window.DashBridgeGrafanaCpuCapacityFilter;
                const cpuContext = capacityFilter?.readContext?.(requestBody) || {
                    helperRefIds: new Set(), loadRefIds: new Set()
                };
                // Only copy the selected panel and its private vCPU helper into the
                // transformation workspace. Neither response filter is allowed to
                // mutate frames belonging to another dashboard panel.
                const workspace = createResponseFilterWorkspace(data, targetRefIds, cpuContext.helperRefIds);
                const scopedData = workspace.data;
                const countSeries = source => Object.values(source?.results || {}).reduce((total, result) => total
                    + (result.frames || []).reduce((frameTotal, frame) => frameTotal
                        + Math.max(0, (frame.schema?.fields || []).filter(field => field.type !== 'time' && field.name !== 'Time').length), 0), 0);
                const beforeSeries = countSeries(scopedData);
                trimResponseDomainLabels(scopedData);
                if (tools.invertIdle) transformCpuData(scopedData);
                const memoryTransform = tools.convertMemToUsed ? transformMemData(scopedData) : null;
                visualMetadata.memoryConversionApplied = tools.convertMemToUsed ? memoryTransform.applied : null;
                const memoryConversionFailed = !!tools.convertMemToUsed && !memoryTransform.applied;
                if (!tools.convertMemToUsed && tools.forceMemByteUnit) restoreMemByteUnit(scopedData);
                // Dynamic vCPU filtering owns only Load Average frames and runs
                // before the generic fixed-threshold series filter. The latter can
                // then safely evaluate the already-scoped result without changing
                // how vCPU capacity is calculated.
                const cpuCapacityFilter = tools.cpuCapacityFilterEnabled
                    ? capacityFilter?.filterResponse?.(scopedData, requestBody, {
                        enabled: true,
                        coefficient: tools.cpuCapacityFilterCoefficient,
                        mode: tools.cpuCapacityFilterMode,
                        trimDomainEnabled: tools.trimDomainEnabled === true,
                        trimDomain: tools.trimDomain,
                        selectedTypes: [
                            tools.cpuCapacityFilterLoad1 !== false ? '1m' : null,
                            tools.cpuCapacityFilterLoad5 === true ? '5m' : null,
                            tools.cpuCapacityFilterLoad15 === true ? '15m' : null
                        ].filter(Boolean)
                    })?.metrics || null
                    : null;
                // The query signature is preferred, but Grafana may rewrite a
                // request before it reaches fetch/XHR. A matching legend refId is
                // still a panel-scoped response and must receive the source filter.
                let sourceFilter = null;
                if (memoryConversionFailed && tools.seriesQueryFilterEnabled) {
                    sourceFilter = { enabled: true, skipped: 'memory-conversion-not-applied' };
                } else if (hasSourceSeriesFilterScope(targetRefIds)) {
                    diagnostics.sourceFilterRuns += 1;
                    sourceFilter = filterSeriesByThreshold(scopedData).metrics;
                }
                if (!memoryConversionFailed) filterLegendData(scopedData);
                visualMetadata.seriesThresholdHighlightRules = collectThresholdHighlightRules(scopedData);
                visualMetadata.seriesCpuCapacityEntries = collectCpuCapacityEntries(scopedData);
                // Lightweight metadata is enough for chart/table fallbacks. Do not
                // walk every value of every series during normal Grafana loading;
                // full report evaluation belongs to an explicit report request.
                visualMetadata.responseTableRecords = collectResponseTableRecords(scopedData);
                visualMetadata.responseSeriesNames = collectResponseSeriesNames(scopedData);
                if (responseSeriesFilterIsEnabled()) {
                    visualMetadata.responseFilterVisibleNames = collectResponseFilterVisibleNames(scopedData);
                    visualMetadata.responseFilterReady = true;
                } else {
                    visualMetadata.responseFilterVisibleNames = [];
                    visualMetadata.responseFilterReady = false;
                }
                // Bind the freshly computed metadata before Grafana consumes the
                // transformed response. For Flot this wraps the current setData;
                // its native data commit then schedules the correctly sized
                // overlay. No delayed redraw or forced plot resize is needed.
                const visualRoot = window.DashBridgeGrafanaDom?.outerPanel(getTargetPanel()) || getTargetPanel() || document;
                syncResponseFilterPresentation(visualRoot);
                diagnostics.transformed += 1;
                const afterSeries = countSeries(scopedData);
                const sourceFilterRemovedEverything = !!sourceFilter?.enabled
                    && sourceFilter.beforeSeries > 0
                    && sourceFilter.thresholdMatchedSeries === 0
                    && sourceFilter.afterSeries === 0;
                const cpuFilterRemovedEverything = !!cpuCapacityFilter?.enabled
                    && cpuCapacityFilter.beforeSeries > 0
                    && cpuCapacityFilter.afterSeries === 0;
                visualMetadata.responseFilterEmptyIsNormal = afterSeries === 0
                    && (sourceFilterRemovedEverything || cpuFilterRemovedEverything);
                if (visualMetadata.responseFilterEmptyIsNormal) setPanelDataStatus('filtered_empty');
                else if (beforeSeries === 0 && afterSeries === 0) setPanelDataStatus('empty_source');
                else setPanelDataStatus('data');
                diagnostics.last = {
                    at: Date.now(), scope, targetRefIds: targetRefIds === null ? null : [...targetRefIds],
                    resultRefIds, beforeSeries, afterSeries, sourceFilter, cpuCapacityFilter,
                    memoryTransform: memoryTransform ? { applied: memoryTransform.applied, reason: memoryTransform.reason } : null,
                    sourceFilterEnabled: !!tools.seriesQueryFilterEnabled,
                    cpuCapacityFilterEnabled: !!tools.cpuCapacityFilterEnabled
                };
                pushEvent('transform', {
                    ...request, scope, resultRefIds,
                    targetRefIds: targetRefIds === null ? null : [...targetRefIds], beforeSeries, afterSeries, sourceFilter, cpuCapacityFilter,
                    memoryTransform: memoryTransform ? { applied: memoryTransform.applied, reason: memoryTransform.reason } : null,
                    invertIdle: !!tools.invertIdle, convertMemToUsed: !!tools.convertMemToUsed,
                    forceMemByteUnit: !!tools.forceMemByteUnit,
                    sourceFilterEnabled: !!tools.seriesQueryFilterEnabled,
                    cpuCapacityFilterEnabled: !!tools.cpuCapacityFilterEnabled
                });
                // Helper results are deliberately removed by filterResponse;
                // commit also expresses that deletion on the original response.
                commitResponseFilterWorkspace(data, workspace);
                archiveResponse(request.requestId, 'after-transform', data, {
                    scope,
                    resultRefIds,
                    targetRefIds: targetRefIds === null ? null : [...targetRefIds],
                    beforeSeries,
                    afterSeries,
                });
                reapplyVisualStylesAfterDataTransform();
                return data;
            };
            const originalFetch = window.fetch;
            window.fetch = async (...args) => {
                const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
                if (!isQueryUrl(url)) return originalFetch(...args);
                const transformActive = hasDataTransform();
                const analysisCapture = window.__dashbridgePanelAnalysisCaptureSession;
                const analysisCaptureActive = !!analysisCapture && !analysisCapture.cancelled;
                const requestStartedAt = performance.now();
                // The production fast path must stay idle while every feature is
                // OFF. E2E is the sole exception: a reset still has to observe the
                // selected panel's request in order to prove a safe baseline.
                const diagnosticObservationActive = window.__dashbridgeE2EDiagnostics?.installed === true;
                const observeActive = transformActive || hasPersistentVisualWork() || isThresholdRestorePending()
                    || diagnosticObservationActive || analysisCaptureActive;
                if (!observeActive) return originalFetch(...args);
                const requestId = beginRequest('fetch', url);
                let effectiveArgs = args;
                let requestBody = null;
                if (transformActive || diagnosticObservationActive || analysisCaptureActive) {
                    requestBody = await window.DashBridgeGrafanaNetwork.readFetchBody(args[0], args[1]).catch(() => null);
                }
                if (tools.cpuCapacityFilterEnabled && requestBody !== null) {
                    const prepared = prepareCpuCapacityRequestBody(requestBody);
                    if (prepared.changed) {
                        requestBody = prepared.body;
                        effectiveArgs = replaceFetchBody(args, prepared.body);
                    }
                }
                const requestBodyPromise = Promise.resolve(requestBody);
                try {
                    const response = await originalFetch(...effectiveArgs);
                    pushEvent('response', { requestId, transport: 'fetch', status: response.status, ok: response.ok });
                    archiveResponse(requestId, 'http-response-metadata', null, {
                        transport: 'fetch',
                        status: response.status,
                        ok: response.ok,
                        redirected: response.redirected,
                        responseType: response.type,
                        url: response.url,
                        headers: Object.fromEntries(response.headers.entries()),
                    });
                    if (!response.ok) {
                        pushEvent('query-error', { requestId, transport: 'fetch', status: response.status });
                        completeRequest(requestId, 'fetch', 'http-error', { httpStatus: response.status });
                        return response;
                    }
                    if (!transformActive) {
                        const requestBody = await requestBodyPromise;
                        if (!isDashboardIframe && analysisCaptureActive
                            && panelAnalysisRequestMatches(analysisCapture, requestBody, requestStartedAt)) {
                            try {
                                const decoded = await decodeNativeFetchResponse(response);
                                observePanelAnalysisResponse(analysisCapture, decoded, requestBody, requestStartedAt);
                            } catch { /* DOM fallback remains available when a datasource response is not JSON. */ }
                        }
                        const targetRefIds = getTargetQueryRefIds(requestBody);
                        const scope = targetRefIds === null
                            ? 'iframe'
                            : (targetRefIds.size ? 'query-signature' : 'none');
                        consumeVisualStylesAfterQuery();
                        pushEvent('transform-skipped', {
                            requestId,
                            transport: 'fetch',
                            reason: 'visual-only-observed',
                            scope,
                            targetRefIds: targetRefIds === null ? null : [...targetRefIds],
                        });
                        completeRequest(requestId, 'fetch', 'completed');
                        return response;
                    }
                    let originalResponseText = null;
                    try {
                        const requestBody = await requestBodyPromise;
                        archiveRequest(requestId, 'fetch', url, requestBody);
                        // The transformed response replaces the native one, so consume the
                        // native body directly. Cloning here tees the stream and leaves the
                        // original branch unread; repeated Grafana refreshes can then retain
                        // buffered response bodies until GC and steadily grow tab memory.
                        originalResponseText = await response.text();
                        const decoded = JSON.parse(originalResponseText);
                        if (analysisCaptureActive && panelAnalysisRequestMatches(analysisCapture, requestBody, requestStartedAt)) {
                            observePanelAnalysisResponse(analysisCapture, decoded, requestBody, requestStartedAt);
                        }
                        const data = transform(decoded, requestBody, { requestId, transport: 'fetch' });
                        consumeVisualStylesAfterQuery();
                        completeRequest(requestId, 'fetch', data?.results ? 'transformed' : 'decode-error');
                        return window.DashBridgeGrafanaNetwork.createJsonResponse(data, response);
                    } catch (error) {
                        pushEvent('decode-error', { requestId, transport: 'fetch', reason: error.message || String(error) });
                        completeRequest(requestId, 'fetch', 'decode-error');
                        return originalResponseText === null
                            ? response
                            : window.DashBridgeGrafanaNetwork.createBodyResponse(originalResponseText, response);
                    }
                } catch (error) {
                    pushEvent('query-error', { requestId, transport: 'fetch', reason: error.message || String(error) });
                    completeRequest(requestId, 'fetch', error?.name === 'AbortError' ? 'aborted' : 'network-error');
                    throw error;
                }
            };
            const originalOpen = XMLHttpRequest.prototype.open;
            const originalSend = XMLHttpRequest.prototype.send;
            XMLHttpRequest.prototype.open = function (method, url) {
                this.__dashbridgeRequestUrl = url;
                return originalOpen.apply(this, arguments);
            };
            XMLHttpRequest.prototype.send = function (body) {
                if (isQueryUrl(this.__dashbridgeRequestUrl)) {
                    const transformActive = hasDataTransform();
                    const analysisCapture = window.__dashbridgePanelAnalysisCaptureSession;
                    const analysisCaptureActive = !!analysisCapture && !analysisCapture.cancelled;
                    const requestStartedAt = performance.now();
                    const diagnosticObservationActive = window.__dashbridgeE2EDiagnostics?.installed === true;
                    const observeActive = transformActive || hasPersistentVisualWork() || isThresholdRestorePending()
                        || diagnosticObservationActive || analysisCaptureActive;
                    if (!observeActive) return originalSend.call(this, body);
                    if (tools.cpuCapacityFilterEnabled) {
                        const prepared = prepareCpuCapacityRequestBody(body);
                        if (prepared.changed) body = prepared.body;
                    }
                    const requestId = beginRequest('xhr', this.__dashbridgeRequestUrl);
                    if (transformActive) archiveRequest(requestId, 'xhr', this.__dashbridgeRequestUrl, body ?? null);
                    this.addEventListener('abort', () => { this.__dashbridgeRequestAborted = true; }, { once: true });
                    this.addEventListener('readystatechange', () => {
                        if (this.readyState !== 4 || this.__dashbridgeRequestFinished) return;
                        this.__dashbridgeRequestFinished = true;
                        const request = { requestId, transport: 'xhr' };
                        pushEvent('response', { ...request, status: this.status, ok: this.status >= 200 && this.status < 300 });
                        archiveResponse(requestId, 'http-response-metadata', null, {
                            transport: 'xhr',
                            status: this.status,
                            ok: this.status >= 200 && this.status < 300,
                            responseURL: this.responseURL,
                            responseType: this.responseType,
                            headers: this.getAllResponseHeaders?.() || '',
                        });
                        if (this.status < 200 || this.status >= 300) {
                            pushEvent('query-error', { ...request, status: this.status });
                            const outcome = this.status === 0
                                ? (this.__dashbridgeRequestAborted ? 'aborted' : 'network-error')
                                : 'http-error';
                            completeRequest(requestId, 'xhr', outcome, { httpStatus: this.status });
                            return;
                        }
                        const captureRequestMatches = analysisCaptureActive
                            && panelAnalysisRequestMatches(analysisCapture, body, requestStartedAt);
                        if (!transformActive && !captureRequestMatches) {
                            const targetRefIds = getTargetQueryRefIds(body);
                            const scope = targetRefIds === null
                                ? 'iframe'
                                : (targetRefIds.size ? 'query-signature' : 'none');
                            consumeVisualStylesAfterQuery();
                            pushEvent('transform-skipped', {
                                ...request,
                                reason: 'visual-only-observed',
                                scope,
                                targetRefIds: targetRefIds === null ? null : [...targetRefIds],
                            });
                            completeRequest(requestId, 'xhr', 'completed');
                            return;
                        }
                        try {
                            const decoded = window.DashBridgeGrafanaNetwork.readXhrJson(this);
                            if (!decoded.supported) throw new Error(`Unsupported XHR responseType: ${decoded.type}`);
                            if (decoded.error) throw decoded.error;
                            if (captureRequestMatches) {
                                observePanelAnalysisResponse(analysisCapture, decoded.data, body, requestStartedAt);
                            }
                            if (!transformActive) {
                                consumeVisualStylesAfterQuery();
                                completeRequest(requestId, 'xhr', 'completed');
                                return;
                            }
                            const json = transform(decoded.data, body, request);
                            consumeVisualStylesAfterQuery();
                            const serialized = JSON.stringify(json);
                            if (decoded.type === 'text') {
                                Object.defineProperty(this, 'responseText', { configurable: true, value: serialized });
                                Object.defineProperty(this, 'response', { configurable: true, value: serialized });
                            }
                            completeRequest(requestId, 'xhr', json?.results ? 'transformed' : 'decode-error');
                        } catch (error) {
                            pushEvent('decode-error', { ...request, reason: error.message || String(error) });
                            completeRequest(requestId, 'xhr', 'decode-error');
                        }
                    });
                }
                return originalSend.call(this, body);
            };
        };
    
    

        return Object.freeze({
            hasDataTransform, markCalculatedTitle, observeCalculatedTitle, installDataInterceptor
        });
    };

    window.DashBridgeGrafanaPanelDataRuntime = Object.freeze({ create });
})();

