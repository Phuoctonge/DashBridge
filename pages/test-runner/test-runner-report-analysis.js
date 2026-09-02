(function initDashBridgeTestReportAnalysis(root) {
    'use strict';
    if (root.DashBridgeTestReportAnalysis) return;

    const visualAudit = root.DashBridgeTestVisualAudit;
    if (!visualAudit?.buildVisualAudit || !visualAudit?.imageAvailable) {
        throw new Error('DashBridgeTestVisualAudit must load before DashBridgeTestReportAnalysis');
    }
    const {
        outcomeOf,
        reasonCodeOf,
        shortReason,
        imageAvailable,
        activeFeatures,
        buildVisualAudit,
    } = visualAudit;

    function groupByReason(entries, outcome) {
        const groups = new Map();
        entries.filter(entry => outcomeOf(entry.test) === outcome).forEach(entry => {
            const code = reasonCodeOf(entry.test);
            if (!groups.has(code)) groups.set(code, { reasonCode: code, count: 0, testIds: [], urls: [], firstReason: shortReason(entry.test) });
            const group = groups.get(code);
            group.count += 1;
            group.testIds.push(entry.test.id);
            if (!group.urls.includes(entry.urlResult.url)) group.urls.push(entry.urlResult.url);
        });
        return [...groups.values()].sort((a, b) => b.count - a.count || a.reasonCode.localeCompare(b.reasonCode));
    }

    function mergePrecomputedAnalysis(snapshot, entries, reconciliation) {
        const units = entries.map(entry => entry.test.analysisUnit);
        const mergeClusters = key => {
            const groups = new Map();
            units.flatMap(unit => unit[key] || []).forEach(group => {
                const current = groups.get(group.reasonCode) || {
                    reasonCode: group.reasonCode, count: 0, testIds: [], urls: [], firstReason: group.firstReason || '',
                };
                current.count += group.count || 0;
                for (const id of group.testIds || []) if (!current.testIds.includes(id)) current.testIds.push(id);
                for (const url of group.urls || []) if (!current.urls.includes(url)) current.urls.push(url);
                groups.set(group.reasonCode, current);
            });
            return [...groups.values()].sort((a, b) => b.count - a.count || a.reasonCode.localeCompare(b.reasonCode));
        };
        const mergeHealthMap = key => {
            const result = new Map();
            units.flatMap(unit => unit[key] || []).forEach(item => {
                const id = item.feature || item.combination;
                const current = result.get(id) || { ...item, transitions: 0, pass: 0, fail: 0, skip: 0, suspicious: 0, tests: [] };
                for (const field of ['transitions', 'pass', 'fail', 'skip', 'suspicious']) current[field] += item[field] || 0;
                for (const testId of item.tests || []) if (!current.tests.includes(testId)) current.tests.push(testId);
                result.set(id, current);
            });
            return [...result.values()];
        };
        const visualEvidenceCoverage = units.reduce((total, unit) => {
            const value = unit.visualEvidenceCoverage || {};
            for (const field of ['captured', 'missing', 'total', 'semanticCaptured', 'physicalImagesCaptured',
                'fullPanelRequired', 'fullPanelCaptured', 'fullPanelMissing', 'viewportRequired',
                'viewportCaptured', 'viewportMissing', 'canvasRequired', 'canvasCaptured']) {
                total[field] += value[field] || 0;
            }
            for (const [phase, count] of Object.entries(value.missingByPhase || {})) {
                total.missingByPhase[phase] = (total.missingByPhase[phase] || 0) + count;
            }
            return total;
        }, {
            captured: 0, missing: 0, total: 0, semanticCaptured: 0, physicalImagesCaptured: 0,
            fullPanelRequired: 0, fullPanelCaptured: 0, fullPanelMissing: 0,
            viewportRequired: 0, viewportCaptured: 0, viewportMissing: 0,
            canvasRequired: 0, canvasCaptured: 0, missingByPhase: {},
        });
        const resetHealth = units.reduce((total, unit) => {
            for (const field of ['pass', 'fail', 'missing', 'unknown']) total[field] += unit.resetHealth?.[field] || 0;
            return total;
        }, { pass: 0, fail: 0, missing: 0, unknown: 0 });
        const settlementRecords = units.flatMap(unit => unit.settlementHealth?.records || []);
        const persistenceRecords = units.flatMap(unit => unit.persistenceHealth?.records || []);
        const commandQueueRecords = units.flatMap(unit => unit.commandQueueHealth?.records || []);
        const actionTraceRecords = units.flatMap(unit => unit.actionTraceHealth?.records || []);
        const diagnosticSnapshotRecords = units.flatMap(unit => unit.diagnosticDepthHealth?.records || []);
        const networkPayloadRecords = (snapshot.results || []).map(result => result.analysisNetworkPayloadRecord).filter(Boolean);
        const settlementHealth = {
            stable: settlementRecords.filter(record => record.status === 'stable').length,
            timeout: settlementRecords.filter(record => record.status === 'timeout').length,
            unknown: settlementRecords.filter(record => !['stable', 'timeout'].includes(record.status)).length,
            total: settlementRecords.length,
            transitionsWithTransientChanges: settlementRecords.filter(record => record.transientChanges > 0).length,
            transitionsWithMutationOnlyActivity: settlementRecords.filter(record => record.mutationOnlyActivity).length,
            maxObservedTransientChanges: settlementRecords.reduce((max, record) => Math.max(max, record.transientChanges || 0), 0),
            slowest: [...settlementRecords].sort((a, b) => b.elapsedMs - a.elapsedMs).slice(0, 20),
            records: settlementRecords,
        };
        const persistenceHealth = {
            required: persistenceRecords.length,
            proven: persistenceRecords.filter(record => record.passed).length,
            failed: persistenceRecords.filter(record => !record.passed).length,
            byFeature: persistenceRecords.reduce((result, record) => {
                (record.activeFeatures || []).forEach(feature => {
                    result[feature] ||= { required: 0, proven: 0, failed: 0 };
                    result[feature].required += 1;
                    result[feature][record.passed ? 'proven' : 'failed'] += 1;
                });
                return result;
            }, {}),
            records: persistenceRecords,
        };
        const orderedQueueRecords = commandQueueRecords.filter(record => Number.isFinite(record.sequence));
        const commandQueueHealth = {
            total: commandQueueRecords.length,
            applied: commandQueueRecords.filter(record => record.commandStatus === 'applied').length,
            errors: commandQueueRecords.filter(record => record.commandStatus === 'error').length,
            maxWaitMs: commandQueueRecords.reduce((max, record) => Math.max(max, Number(record.waitMs) || 0), 0),
            duplicateSequences: orderedQueueRecords.filter((record, index, all) => all.findIndex(item => item.sequence === record.sequence) !== index),
            outOfOrder: orderedQueueRecords.filter((record, index, all) => index > 0 && record.sequence <= all[index - 1].sequence),
            records: commandQueueRecords,
        };
        const actionTraceHealth = {
            testsWithTimeline: units.reduce((sum, unit) => sum + (unit.actionTraceHealth?.testsWithTimeline || 0), 0),
            testsWithoutTimeline: units.reduce((sum, unit) => sum + (unit.actionTraceHealth?.testsWithoutTimeline || 0), 0),
            totalActions: actionTraceRecords.length,
            totalCheckpoints: actionTraceRecords.reduce((sum, record) => sum + (record.checkpoints || 0), 0),
            totalDiffs: actionTraceRecords.reduce((sum, record) => sum + (record.diffs?.length || 0), 0),
            totalChangedPaths: actionTraceRecords.reduce((sum, record) => sum
                + (record.diffs || []).reduce((diffSum, diff) => diffSum + (diff.changeCount || 0), 0), 0),
            truncatedDiffs: actionTraceRecords.flatMap(record => record.diffs || []).filter(diff => diff.truncated).length,
            runtimeEvents: actionTraceRecords.reduce((sum, record) => sum + (record.runtimeEvents || 0), 0),
            records: actionTraceRecords,
        };
        const networkPayloadHealth = {
            urls: networkPayloadRecords.length,
            requests: networkPayloadRecords.reduce((sum, record) => sum + record.requests, 0),
            responses: networkPayloadRecords.reduce((sum, record) => sum + record.responses, 0),
            observations: networkPayloadRecords.reduce((sum, record) => sum + record.observations, 0),
            payloadBytes: networkPayloadRecords.reduce((sum, record) => sum + record.payloadBytes, 0),
            payloadErrors: networkPayloadRecords.reduce((sum, record) => sum + record.payloadErrors, 0),
            records: networkPayloadRecords,
        };
        const diagnosticDepthHealth = {
            snapshots: diagnosticSnapshotRecords.length,
            withEnvironment: diagnosticSnapshotRecords.filter(record => record.environmentCaptured).length,
            withDom: diagnosticSnapshotRecords.filter(record => record.domCaptured).length,
            withPanelImage: diagnosticSnapshotRecords.filter(record => record.panelImageCaptured).length,
            withViewportImage: diagnosticSnapshotRecords.filter(record => record.viewportImageCaptured).length,
            physicalPanelCaptures: diagnosticSnapshotRecords.filter(record => ['captured', 'captured-after-reuse-mismatch'].includes(record.visualCaptureMode)
                && record.panelImageCaptured).length,
            canvasOnlyCaptures: diagnosticSnapshotRecords.filter(record => record.visualCaptureMode === 'captured-canvas').length,
            semanticOnlySnapshots: diagnosticSnapshotRecords.filter(record => record.visualCaptureMode === 'hash-only').length,
            reusedEquivalentPanelCaptures: diagnosticSnapshotRecords.filter(record => record.visualCaptureMode === 'reused-equivalent').length,
            reuseMismatches: diagnosticSnapshotRecords.filter(record => record.visualCaptureMode === 'captured-after-reuse-mismatch').length,
            canvasImages: diagnosticSnapshotRecords.reduce((sum, record) => sum + record.canvasImagesCaptured, 0),
            domOuterHTMLBytes: diagnosticSnapshotRecords.reduce((sum, record) => sum + record.domOuterHTMLBytes, 0),
            networkEvents: diagnosticSnapshotRecords.reduce((sum, record) => sum + record.networkEvents, 0),
            visualReapplyEvents: diagnosticSnapshotRecords.reduce((sum, record) => sum + record.visualReapplyEvents, 0),
            debugLogs: diagnosticSnapshotRecords.reduce((sum, record) => sum + record.debugLogs, 0),
            records: diagnosticSnapshotRecords,
        };
        const failureClusters = mergeClusters('failureClusters');
        const notRunClusters = mergeClusters('notRunClusters');
        const suspiciousPasses = units.flatMap(unit => unit.suspiciousPasses || []);
        const recommendations = [];
        const codes = new Set(failureClusters.map(group => group.reasonCode));
        if (codes.has('reset-native-legend-not-restored')) recommendations.push('Проверить явную команду восстановления legendVisibility и нативный disabled-state строк легенды.');
        if (codes.has('isolation-reset-failed')) recommendations.push('Считать последующие isolation-reset-failed каскадом первичного неудачного reset, а не независимыми дефектами функций.');
        if ([...codes].some(code => code.startsWith('lifecycle-'))) recommendations.push('Сопоставить target query signatures с фактическим response journal выбранной панели.');
        if (notRunClusters.length) recommendations.push('Разобрать первичную причину NOT RUN; незапущенные сценарии не являются PASS, FAIL или SKIP.');
        if (!reconciliation.valid) recommendations.push('Исправить счётчики жизненного цикла: planned должен равняться completed + abortedNotRun.');
        if (suspiciousPasses.length) recommendations.push('Проверить визуально зелёные сценарии из suspiciousPasses: автоматический аудит не увидел ожидаемого изменения либо полного набора кадров.');
        if (settlementHealth.timeout) recommendations.push('Разобрать settlement timeout: команда или query завершились, но DOM/легенда/canvas панели не достигли устойчивого состояния. Покадровые samples сохранены в переходе.');
        return {
            verdict: entries.some(entry => outcomeOf(entry.test) === 'fail') ? 'failed'
                : entries.some(entry => outcomeOf(entry.test) === 'not-run') ? 'incomplete'
                    : suspiciousPasses.length ? 'suspicious' : 'passed',
            primaryFailure: units.map(unit => unit.primaryFailure).find(Boolean) || null,
            failureClusters,
            skipClusters: mergeClusters('skipClusters'),
            notRunClusters,
            suspiciousPasses,
            visualEvidenceCoverage,
            featureHealth: mergeHealthMap('featureHealth').sort((a, b) => a.feature.localeCompare(b.feature)),
            combinationHealth: mergeHealthMap('combinationHealth')
                .sort((a, b) => b.transitions - a.transitions || a.combination.localeCompare(b.combination)),
            resetHealth, settlementHealth, persistenceHealth, commandQueueHealth, actionTraceHealth,
            networkPayloadHealth, diagnosticDepthHealth,
            slowestTests: units.flatMap(unit => unit.slowestTests || [])
                .sort((a, b) => b.durationMs - a.durationMs).slice(0, 10),
            recommendations,
        };
    }

    function buildAnalysis(snapshot, entries, reconciliation) {
        if (entries.length && entries.every(entry => entry.test?.analysisUnit)) {
            return mergePrecomputedAnalysis(snapshot, entries, reconciliation);
        }
        const failures = entries.filter(entry => outcomeOf(entry.test) === 'fail');
        const notRun = entries.filter(entry => outcomeOf(entry.test) === 'not-run');
        const failureClusters = groupByReason(entries, 'fail');
        const primary = failures[0] || null;
        const visualAudits = entries.map(entry => ({ entry, audit: buildVisualAudit(entry.test) }));
        const suspiciousPasses = visualAudits
            .filter(item => item.audit.suspicious)
            .map(item => ({
                url: item.entry.urlResult.url,
                testId: item.entry.test.id,
                testName: item.entry.test.name,
                issues: item.audit.issues,
            }));
        const evidencePhases = visualAudits.flatMap(item => item.audit.phases).filter(phase => phase.required);
        const combinationMap = new Map();
        const featureMap = new Map();
        visualAudits.forEach(item => item.audit.transitions.forEach(transition => {
            const key = transition.activeFeatures.length
                ? [...transition.activeFeatures].sort().join(' + ') : '(all-off)';
            if (!combinationMap.has(key)) combinationMap.set(key, { activeSet: transition.activeFeatures, transitions: 0, pass: 0, fail: 0, skip: 0, suspicious: 0, tests: [] });
            const combination = combinationMap.get(key);
            combination.transitions += 1;
            const outcome = transition.outcome || 'unknown';
            if (Object.prototype.hasOwnProperty.call(combination, outcome)) combination[outcome] += 1;
            if (transition.issues.length) combination.suspicious += 1;
            if (!combination.tests.includes(item.entry.test.id)) combination.tests.push(item.entry.test.id);
            transition.activeFeatures.forEach(feature => {
                if (!featureMap.has(feature)) featureMap.set(feature, { feature, transitions: 0, pass: 0, fail: 0, skip: 0, suspicious: 0, tests: [] });
                const health = featureMap.get(feature);
                health.transitions += 1;
                if (Object.prototype.hasOwnProperty.call(health, outcome)) health[outcome] += 1;
                if (transition.issues.length) health.suspicious += 1;
                if (!health.tests.includes(item.entry.test.id)) health.tests.push(item.entry.test.id);
            });
        }));
        const resetHealth = entries.filter(entry => entry.test?.diagnostic?.kind === 'transition').reduce((health, entry) => {
            const reset = entry.test?.diagnostic?.reset;
            if (!reset) health.missing += 1;
            else if (reset.pass === true) health.pass += 1;
            else if (reset.pass === false) health.fail += 1;
            else health.unknown += 1;
            return health;
        }, { pass: 0, fail: 0, missing: 0, unknown: 0 });
        const settlementRecords = [];
        entries.forEach(entry => {
            const diagnostic = entry.test?.diagnostic;
            if (diagnostic?.kind !== 'transition') return;
            const add = (phase, settlement) => {
                if (!settlement) return;
                const samples = settlement.samples || [];
                const distinctFingerprints = new Set(samples.map(sample => JSON.stringify({
                    rootGeneration: sample.rootGeneration,
                    rootGeometry: sample.rootGeometry,
                    canvas: sample.canvas,
                    legend: sample.legend,
                    markers: sample.markers,
                    tools: sample.tools,
                    query: sample.query,
                    threshold: sample.threshold,
                }))).size;
                settlementRecords.push({
                    url: entry.urlResult.url,
                    testId: entry.test.id,
                    phase,
                    status: settlement.status || 'unknown',
                    reason: settlement.reason || '',
                    elapsedMs: settlement.elapsedMs || 0,
                    observedFrames: settlement.observedFrames ?? samples.length,
                    observedMutations: settlement.observedMutations || 0,
                    mutationSummary: settlement.mutationSummary || null,
                    distinctObservedStates: distinctFingerprints,
                    transientChanges: Math.max(0, distinctFingerprints - 1),
                    mutationOnlyActivity: (settlement.observedMutations || 0) > 0 && distinctFingerprints <= 1,
                });
            };
            add('isolation', diagnostic.isolation?.settlement);
            (diagnostic.transitions || []).forEach((transition, index) => {
                add(`transition-${index + 1}`, transition.settlement || transition.command?.settlement);
                add(`transition-${index + 1}-persistence-refresh`, transition.persistence?.settlement || transition.command?.persistence?.settlement);
            });
            add('reset', diagnostic.reset?.settlement || diagnostic.reset?.command?.settlement);
        });
        const settlementHealth = {
            stable: settlementRecords.filter(record => record.status === 'stable').length,
            timeout: settlementRecords.filter(record => record.status === 'timeout').length,
            unknown: settlementRecords.filter(record => !['stable', 'timeout'].includes(record.status)).length,
            total: settlementRecords.length,
            transitionsWithTransientChanges: settlementRecords.filter(record => record.transientChanges > 0).length,
            transitionsWithMutationOnlyActivity: settlementRecords.filter(record => record.mutationOnlyActivity).length,
            maxObservedTransientChanges: settlementRecords.reduce((max, record) => Math.max(max, record.transientChanges), 0),
            slowest: [...settlementRecords].sort((a, b) => b.elapsedMs - a.elapsedMs).slice(0, 20),
            records: settlementRecords,
        };
        const persistenceRecords = entries.flatMap(entry => (entry.test?.diagnostic?.transitions || [])
            .map((transition, index) => ({ entry, transition, index }))
            .filter(item => (item.transition.persistence || item.transition.command?.persistence)?.required)
            .map(item => {
                const persistence = item.transition.persistence || item.transition.command.persistence;
                return {
                    url: item.entry.urlResult.url,
                    testId: item.entry.test.id,
                    transition: item.index + 1,
                    activeFeatures: item.transition.activeIds || activeFeatures(item.transition.settings),
                    status: persistence.status || 'unknown',
                    passed: persistence.passed === true,
                    reason: persistence.reason || '',
                    lifecycleStatus: persistence.lifecycle?.status || null,
                    settlementStatus: persistence.settlement?.status || null,
                    refreshMethod: persistence.refresh || null,
                    visualReapply: persistence.visualReapply || null,
                };
            }));
        const persistenceHealth = {
            required: persistenceRecords.length,
            proven: persistenceRecords.filter(record => record.passed).length,
            failed: persistenceRecords.filter(record => !record.passed).length,
            byFeature: persistenceRecords.reduce((result, record) => {
                record.activeFeatures.forEach(feature => {
                    result[feature] ||= { required: 0, proven: 0, failed: 0 };
                    result[feature].required += 1;
                    result[feature][record.passed ? 'proven' : 'failed'] += 1;
                });
                return result;
            }, {}),
            records: persistenceRecords,
        };
        const commandQueueRecords = [];
        entries.forEach(entry => {
            const diagnostic = entry.test?.diagnostic;
            if (diagnostic?.kind !== 'transition') return;
            const add = (phase, acknowledgement, status) => {
                const queue = acknowledgement?.queue;
                if (!queue) return;
                commandQueueRecords.push({
                    url: entry.urlResult.url,
                    testId: entry.test.id,
                    phase,
                    status: status || acknowledgement.commandStatus || 'unknown',
                    commandStatus: acknowledgement.commandStatus || null,
                    sequence: queue.sequence ?? null,
                    enqueuedAt: queue.enqueuedAt ?? null,
                    startedAt: queue.startedAt ?? null,
                    completedAt: acknowledgement.completedAt ?? null,
                    waitMs: queue.waitMs ?? null,
                });
            };
            add('isolation', diagnostic.isolation?.acknowledgement, diagnostic.isolation?.status);
            (diagnostic.transitions || []).forEach((transition, index) => add(
                `transition-${index + 1}`,
                transition.command?.acknowledgement,
                transition.command?.status
            ));
            add('reset', diagnostic.reset?.command?.acknowledgement, diagnostic.reset?.command?.status);
        });
        const orderedQueueRecords = commandQueueRecords.filter(record => Number.isFinite(record.sequence));
        const commandQueueHealth = {
            total: commandQueueRecords.length,
            applied: commandQueueRecords.filter(record => record.commandStatus === 'applied').length,
            errors: commandQueueRecords.filter(record => record.commandStatus === 'error').length,
            maxWaitMs: commandQueueRecords.reduce((max, record) => Math.max(max, Number(record.waitMs) || 0), 0),
            duplicateSequences: orderedQueueRecords.filter((record, index, all) => all.findIndex(item => item.sequence === record.sequence) !== index),
            outOfOrder: orderedQueueRecords.filter((record, index, all) => index > 0 && record.sequence <= all[index - 1].sequence),
            records: commandQueueRecords,
        };
        const actionTraceRecords = entries.flatMap(entry => (entry.test?.diagnostic?.actionTimeline || []).map(action => ({
            url: entry.urlResult.url,
            testId: entry.test.id,
            sequence: action.sequence ?? null,
            action: action.action || 'unknown',
            transitionIndex: action.transitionIndex ?? null,
            startedAt: action.startedAt || null,
            finishedAt: action.finishedAt || null,
            durationMs: action.durationMs ?? null,
            status: action.output?.status || null,
            passed: action.output?.pass ?? action.output?.invariant?.pass ?? null,
            checkpoints: action.checkpoints?.length || 0,
            snapshots: Object.keys(action.snapshotRefs || action.snapshots || {}),
            diffs: (action.diffs || []).map(diff => ({
                phase: diff.phase || null,
                changed: diff.changed === true,
                changeCount: diff.changeCount || 0,
                truncated: diff.truncated === true,
                elapsedMs: diff.elapsedMs ?? null,
            })),
            runtimeEvents: action.output?.runtimeEvents?.events?.length || 0,
        })));
        const actionTraceHealth = {
            testsWithTimeline: entries.filter(entry => (entry.test?.diagnostic?.actionTimeline || []).length > 0).length,
            testsWithoutTimeline: entries.filter(entry => outcomeOf(entry.test) !== 'not-run'
                && !(entry.test?.diagnostic?.actionTimeline || []).length).length,
            totalActions: actionTraceRecords.length,
            totalCheckpoints: actionTraceRecords.reduce((sum, record) => sum + record.checkpoints, 0),
            totalDiffs: actionTraceRecords.reduce((sum, record) => sum + record.diffs.length, 0),
            totalChangedPaths: actionTraceRecords.reduce((sum, record) => sum
                + record.diffs.reduce((diffSum, diff) => diffSum + diff.changeCount, 0), 0),
            truncatedDiffs: actionTraceRecords.flatMap(record => record.diffs).filter(diff => diff.truncated).length,
            runtimeEvents: actionTraceRecords.reduce((sum, record) => sum + record.runtimeEvents, 0),
            records: actionTraceRecords,
        };
        const networkPayloadRecords = (snapshot.results || []).map(urlResult => {
            const archive = urlResult.diagnostic?.networkPayloadArchive || {};
            const requests = Object.values(archive.requests || {});
            const responses = Object.values(archive.responses || {});
            const observations = responses.flatMap(response => response.observations || []);
            const payloads = [
                ...requests.map(request => request.body),
                ...observations.map(observation => observation.payload),
            ].filter(Boolean);
            return {
                url: urlResult.url,
                schema: archive.schema || null,
                requests: requests.length,
                responses: responses.length,
                observations: observations.length,
                payloadBytes: payloads.reduce((sum, payload) => sum + (Number(payload.textBytes) || 0), 0),
                payloadErrors: payloads.filter(payload => payload.error).length,
                requestIds: requests.map(request => request.requestId),
            };
        });
        const networkPayloadHealth = {
            urls: networkPayloadRecords.length,
            requests: networkPayloadRecords.reduce((sum, record) => sum + record.requests, 0),
            responses: networkPayloadRecords.reduce((sum, record) => sum + record.responses, 0),
            observations: networkPayloadRecords.reduce((sum, record) => sum + record.observations, 0),
            payloadBytes: networkPayloadRecords.reduce((sum, record) => sum + record.payloadBytes, 0),
            payloadErrors: networkPayloadRecords.reduce((sum, record) => sum + record.payloadErrors, 0),
            records: networkPayloadRecords,
        };
        const diagnosticSnapshotRecords = entries.flatMap(entry => {
            const diagnostic = entry.test?.diagnostic || {};
            const snapshots = [
                ['external-before', diagnostic.before],
                ['opened', diagnostic.opened],
                ['baseline', diagnostic.baseline],
                ...((diagnostic.transitions || []).flatMap((transition, index) => [
                    [`transition-${index + 1}-before`, transition.before],
                    [`transition-${index + 1}-after-command-before-refresh`, transition.command?.afterCommandBeforeRefresh],
                    [`transition-${index + 1}-after-first-refresh`, transition.persistence?.beforeRefresh || transition.command?.persistence?.beforeRefresh],
                    [`transition-${index + 1}-after-second-refresh`, transition.after],
                ])),
                ['before-reset', diagnostic.beforeReset],
                ['reset-after-command-before-refresh', diagnostic.reset?.command?.afterCommandBeforeRefresh],
                ['reset-after', diagnostic.reset?.after],
                ['external-after', diagnostic.after],
            ];
            return snapshots.filter(([, value]) => value).map(([phase, value]) => ({
                url: entry.urlResult.url,
                testId: entry.test.id,
                phase,
                at: value.at || null,
                environmentCaptured: !!value.environment,
                domCaptured: !!value.domSnapshot?.root,
                domOuterHTMLBytes: value.domSnapshot?.root?.outerHTMLBytes || 0,
                panelImageCaptured: imageAvailable(value.panelImage),
                viewportImageCaptured: imageAvailable(value.viewportImage),
                visualCaptureMode: value.visualCapture?.mode || 'legacy-unknown',
                visualCaptureSourceAt: value.visualCapture?.sourceAt || null,
                canvasImagesCaptured: (value.canvas || []).filter(imageAvailable).length,
                networkEvents: value.interceptor?.events?.length || 0,
                visualReapplyEvents: value.visualReapplyDiagnostic?.events?.length || 0,
                debugLogs: value.logs?.length || 0,
            }));
        });
        const diagnosticDepthHealth = {
            snapshots: diagnosticSnapshotRecords.length,
            withEnvironment: diagnosticSnapshotRecords.filter(record => record.environmentCaptured).length,
            withDom: diagnosticSnapshotRecords.filter(record => record.domCaptured).length,
            withPanelImage: diagnosticSnapshotRecords.filter(record => record.panelImageCaptured).length,
            withViewportImage: diagnosticSnapshotRecords.filter(record => record.viewportImageCaptured).length,
            physicalPanelCaptures: diagnosticSnapshotRecords.filter(record => ['captured', 'captured-after-reuse-mismatch'].includes(record.visualCaptureMode)
                && record.panelImageCaptured).length,
            canvasOnlyCaptures: diagnosticSnapshotRecords.filter(record => record.visualCaptureMode === 'captured-canvas').length,
            semanticOnlySnapshots: diagnosticSnapshotRecords.filter(record => record.visualCaptureMode === 'hash-only').length,
            reusedEquivalentPanelCaptures: diagnosticSnapshotRecords.filter(record => record.visualCaptureMode === 'reused-equivalent').length,
            reuseMismatches: diagnosticSnapshotRecords.filter(record => record.visualCaptureMode === 'captured-after-reuse-mismatch').length,
            canvasImages: diagnosticSnapshotRecords.reduce((sum, record) => sum + record.canvasImagesCaptured, 0),
            domOuterHTMLBytes: diagnosticSnapshotRecords.reduce((sum, record) => sum + record.domOuterHTMLBytes, 0),
            networkEvents: diagnosticSnapshotRecords.reduce((sum, record) => sum + record.networkEvents, 0),
            visualReapplyEvents: diagnosticSnapshotRecords.reduce((sum, record) => sum + record.visualReapplyEvents, 0),
            debugLogs: diagnosticSnapshotRecords.reduce((sum, record) => sum + record.debugLogs, 0),
            records: diagnosticSnapshotRecords,
        };
        const recommendations = [];
        const codes = new Set(failureClusters.map(group => group.reasonCode));
        if (codes.has('reset-native-legend-not-restored')) recommendations.push('Проверить явную команду восстановления legendVisibility и нативный disabled-state строк легенды.');
        if (codes.has('isolation-reset-failed')) recommendations.push('Считать последующие isolation-reset-failed каскадом первичного неудачного reset, а не независимыми дефектами функций.');
        if ([...codes].some(code => code.startsWith('lifecycle-'))) recommendations.push('Сопоставить target query signatures с фактическим response journal выбранной панели.');
        if (notRun.length) recommendations.push('Разобрать первичную причину NOT RUN; незапущенные сценарии не являются PASS, FAIL или SKIP.');
        if (!reconciliation.valid) recommendations.push('Исправить счётчики жизненного цикла: planned должен равняться completed + abortedNotRun.');
        if (suspiciousPasses.length) recommendations.push('Проверить визуально зелёные сценарии из suspiciousPasses: автоматический аудит не увидел ожидаемого изменения либо полного набора кадров.');
        if (settlementHealth.timeout) recommendations.push('Разобрать settlement timeout: команда или query завершились, но DOM/легенда/canvas панели не достигли устойчивого состояния. Покадровые samples сохранены в переходе.');

        return {
            verdict: failures.length ? 'failed' : (notRun.length ? 'incomplete' : (suspiciousPasses.length ? 'suspicious' : 'passed')),
            primaryFailure: primary ? {
                url: primary.urlResult.url,
                testId: primary.test.id,
                testName: primary.test.name,
                reasonCode: reasonCodeOf(primary.test),
                reason: shortReason(primary.test),
            } : null,
            failureClusters,
            skipClusters: groupByReason(entries, 'skip'),
            notRunClusters: groupByReason(entries, 'not-run'),
            suspiciousPasses,
            visualEvidenceCoverage: {
                captured: evidencePhases.filter(phase => phase.satisfied).length,
                missing: evidencePhases.filter(phase => !phase.satisfied).length,
                total: evidencePhases.length,
                semanticCaptured: evidencePhases.filter(phase => phase.semanticCaptured).length,
                physicalImagesCaptured: evidencePhases.filter(phase => phase.captured).length,
                fullPanelRequired: evidencePhases.filter(phase => ['panel', 'forensic'].includes(phase.requirement)).length,
                fullPanelCaptured: evidencePhases.filter(phase => ['panel', 'forensic'].includes(phase.requirement) && phase.panelImageCaptured).length,
                fullPanelMissing: evidencePhases.filter(phase => ['panel', 'forensic'].includes(phase.requirement) && !phase.panelImageCaptured).length,
                viewportRequired: evidencePhases.filter(phase => phase.requirement === 'forensic').length,
                viewportCaptured: evidencePhases.filter(phase => phase.requirement === 'forensic' && phase.viewportImageCaptured).length,
                viewportMissing: evidencePhases.filter(phase => phase.requirement === 'forensic' && !phase.viewportImageCaptured).length,
                canvasRequired: evidencePhases.filter(phase => ['canvas', 'panel', 'forensic'].includes(phase.requirement)).length,
                canvasCaptured: evidencePhases.filter(phase => ['canvas', 'panel', 'forensic'].includes(phase.requirement) && phase.canvasCaptured).length,
                missingByPhase: evidencePhases.filter(phase => !phase.satisfied).reduce((result, phase) => {
                    result[phase.phase] = (result[phase.phase] || 0) + 1;
                    return result;
                }, {}),
            },
            featureHealth: [...featureMap.values()].sort((a, b) => a.feature.localeCompare(b.feature)),
            combinationHealth: [...combinationMap.entries()].map(([combination, value]) => ({ combination, ...value }))
                .sort((a, b) => b.transitions - a.transitions || a.combination.localeCompare(b.combination)),
            resetHealth,
            settlementHealth,
            persistenceHealth,
            commandQueueHealth,
            actionTraceHealth,
            networkPayloadHealth,
            diagnosticDepthHealth,
            slowestTests: [...entries]
                .sort((a, b) => (b.test.durationMs || 0) - (a.test.durationMs || 0))
                .slice(0, 10)
                .map(entry => ({ testId: entry.test.id, url: entry.urlResult.url, durationMs: entry.test.durationMs || 0, outcome: outcomeOf(entry.test) })),
            recommendations,
        };
    }

    root.DashBridgeTestReportAnalysis = Object.freeze({ buildAnalysis });
})(globalThis);
