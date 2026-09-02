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
            const reducedSeriesRecord = frame => {
                const fields = frame?.schema?.fields || [];
                const columns = frame?.data?.values || [];
                const numericIndexes = fields.map((field, index) => field?.type === 'number' ? index : -1)
                    .filter(index => index >= 0);
                const hasTime = fields.some(field => field?.type === 'time' || field?.name === 'Time');
                if (!hasTime || numericIndexes.length !== 1) return null;
                const valueIndex = numericIndexes[0];
                const values = Array.from(columns[valueIndex] || []).map(Number).filter(Number.isFinite);
                if (values.length !== 1) return null;
                const valueField = fields[valueIndex] || {};
                const name = String(valueField?.config?.displayNameFromDS || frame?.schema?.name
                    || Object.values(valueField?.labels || {})[0] || '').trim();
                return name ? { name: name.substring(0, 500), value: values[0] } : null;
            };
            outer: for (const result of Object.values(data?.results || {})) {
                for (const frame of result.frames || []) {
                    const shape = getResponseTableFrameShape(frame);
                    if (!shape) {
                        const reduced = reducedSeriesRecord(frame);
                        if (reduced) records.push(reduced);
                        if (records.length >= MAX_TABLE_RECORDS) break outer;
                        continue;
                    }
                    if (shape.timeIndexes.length && !targetPanelUsesTable()) continue;
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
    
        return Object.freeze({
            trimResponseDomainLabels, transformCpuData, transformMemData, restoreMemByteUnit,
            collectResponseTableRecords, filterSeriesByThreshold, getFieldLegendNames,
            collectResponseSeriesNames, collectResponseFilterVisibleNames,
            collectThresholdHighlightRules, collectCpuCapacityEntries, filterLegendData,
            hasSourceSeriesFilterScope, hasDataTransform
        });
    };

    window.DashBridgeGrafanaPanelDataTransforms = Object.freeze({ create });
})();
