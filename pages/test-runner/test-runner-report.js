// Test Runner self-diagnosing, lossless-evidence JSON artifact builder.

'use strict';

const DashBridgeTestReport = (() => {
    const SCHEMA = 'dashbridge-e2e-diagnostics/v4';

    const outcomeOf = test => test?.aborted ? 'not-run'
        : test?.skip ? 'skip'
            : test?.pass ? 'pass' : 'fail';

    function reasonCodeOf(test) {
        if (typeof test?.reasonCode === 'string' && test.reasonCode) return test.reasonCode;
        const outcome = outcomeOf(test);
        const details = String(test?.details || '');
        const reset = test?.diagnostic?.reset;
        const failedTransition = (test?.diagnostic?.transitions || [])
            .find(step => step?.verdict?.outcome === 'fail' || step?.invariant?.pass === false);
        const commandStatus = failedTransition?.command?.status || '';
        const lifecycleStatus = failedTransition?.lifecycle?.status || '';
        const settlementStatus = failedTransition?.settlement?.status
            || failedTransition?.command?.settlement?.status || '';
        const persistenceStatus = failedTransition?.persistence?.status
            || failedTransition?.command?.persistence?.status || '';
        const isolationSettlementStatus = test?.diagnostic?.isolation?.settlement?.status || '';
        const resetSettlementStatus = reset?.settlement?.status || reset?.command?.settlement?.status || '';
        const resetReason = reset?.verdict?.reason || reset?.invariant?.reason || '';

        if (outcome === 'not-run') return test?.diagnostic?.environmentUnsafe
            ? 'not-run-environment-unsafe' : 'not-run-aborted';
        if (outcome === 'skip') {
            if (/CPU-панели/i.test(details)) return 'capability-no-cpu';
            if (/RAM-панели/i.test(details)) return 'capability-no-ram';
            if (/легенд/i.test(details)) return 'capability-no-legend';
            if (/серий/i.test(details)) return 'capability-no-series';
            return 'capability-skip';
        }
        if (outcome !== 'fail') return 'pass';
        if (test?.timedOut || /таймаут/i.test(details)) return 'test-timeout';
        if (isolationSettlementStatus === 'timeout') return 'isolation-panel-settlement-timeout';
        if (resetSettlementStatus === 'timeout') return 'reset-panel-settlement-timeout';
        if (settlementStatus === 'timeout') return 'panel-settlement-timeout';
        if (persistenceStatus === 'failed') return 'persistence-refresh-failed';
        if (commandStatus === 'isolation-reset-failed' || /isolation-reset-failed/.test(details)) {
            return 'isolation-reset-failed';
        }
        const nativeLegendFailed = reset?.nativeLegend?.pass === false
            || /(?:легенд[^;]*не восстанов|не восстанов[^;]*легенд)/i.test(resetReason);
        if (reset?.pass === false && nativeLegendFailed) return 'reset-native-legend-not-restored';
        if (reset?.pass === false) return 'reset-not-proven';
        if (commandStatus && commandStatus !== 'applied') return `command-${commandStatus}`;
        if (lifecycleStatus && lifecycleStatus !== 'target-complete') return `lifecycle-${lifecycleStatus}`;
        if ((test?.diagnostic?.verdict?.runtime?.dashBridgeErrorCount || 0) > 0) return 'runtime-dashbridge-error';
        if (test?.error) return 'test-exception';
        return 'semantic-invariant-failed';
    }

    function shortReason(test) {
        if (typeof test?.shortReason === 'string' && test.shortReason) return test.shortReason;
        const reset = test?.diagnostic?.reset;
        const failedTransition = (test?.diagnostic?.transitions || [])
            .find(step => step?.verdict?.outcome === 'fail' || step?.invariant?.pass === false);
        const failedResetReason = reset?.pass === false
            ? (reset?.verdict?.reason || reset?.invariant?.reason)
            : '';
        return failedResetReason
            || failedTransition?.verdict?.reason
            || failedTransition?.invariant?.reason
            || test?.diagnostic?.verdict?.reason
            || test?.diagnostic?.reason
            || test?.details
            || '';
    }

    function hashText(value) {
        let hash = 2166136261;
        for (let i = 0; i < value.length; i += 1) {
            hash ^= value.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(16).padStart(8, '0');
    }

    function estimatedDataUrlBytes(value) {
        const comma = value.indexOf(',');
        const payload = comma >= 0 ? value.length - comma - 1 : value.length;
        return Math.ceil(payload * 0.75);
    }

    function createCompactor() {
        const images = {};
        const domSnapshots = {};
        const diagnosticEvents = {};
        const performanceResources = {};
        const visualStates = {};
        let retainedImageBytes = 0;
        const canonicalValues = new Map();

        const registerValue = (store, prefix, value, metadata = {}) => {
            const canonical = typeof value === 'string' ? value : JSON.stringify(value);
            const baseRef = `${prefix}-${hashText(canonical)}`;
            let ref = baseRef;
            let collision = 1;
            while (Object.prototype.hasOwnProperty.call(store, ref)
                && canonicalValues.get(ref) !== canonical) {
                ref = `${baseRef}-${collision}`;
                collision += 1;
            }
            if (!Object.prototype.hasOwnProperty.call(store, ref)) {
                store[ref] = { ...metadata, value };
                canonicalValues.set(ref, canonical);
            }
            return ref;
        };
        const registerImage = dataUrl => {
            const bytes = estimatedDataUrlBytes(dataUrl);
            const ref = `img-${hashText(dataUrl)}`;
            if (images[ref]) return { imageRef: ref, imageBytes: bytes };
            images[ref] = { mimeType: dataUrl.slice(5, dataUrl.indexOf(';') > 0 ? dataUrl.indexOf(';') : dataUrl.indexOf(',')), bytes, dataUrl };
            retainedImageBytes += bytes;
            return { imageRef: ref, imageBytes: bytes };
        };

        const referenceArray = (items, store, prefix, kind) => items.map(item => ({
            assetRef: registerValue(store, prefix, item, { kind }),
        }));

        const isDiagnosticEventPath = path => /(?:interceptor|visualReapplyDiagnostic)(?:\.\w+)*\.events$/.test(path)
            || /(?:network|visualReapply)\.(?:before|after)\.events$/.test(path);

        const compact = (value, options = {}, depth = 0) => {
            const path = options.path || '';
            if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') return value;
            if (typeof value === 'string') return value;
            if (depth >= 50) return '[depth-safety-stop]';
            if (Array.isArray(value)) {
                if (isDiagnosticEventPath(path)) {
                    return referenceArray(value, diagnosticEvents, 'evt', 'diagnostic-event');
                }
                if (path.endsWith('.environment.resources')) {
                    return referenceArray(value, performanceResources, 'res', 'performance-resource');
                }
                return value.map((item, index) => compact(item, { ...options, path: `${path}.${index}` }, depth + 1));
            }
            if (typeof value !== 'object') return `[${typeof value}]`;

            const output = {};
            for (const [key, item] of Object.entries(value)) {
                const itemPath = path ? `${path}.${key}` : key;
                if (key === 'dataUrl' && typeof item === 'string' && item.startsWith('data:image/')) {
                    Object.assign(output, registerImage(item));
                    continue;
                }
                if (key === 'outerHTML' && typeof item === 'string' && itemPath.endsWith('.domSnapshot.root.outerHTML')) {
                    output.outerHTMLRef = registerValue(domSnapshots, 'dom', item, {
                        kind: 'panel-outer-html',
                        bytes: item.length,
                    });
                    continue;
                }
                output[key] = compact(item, { ...options, path: itemPath }, depth + 1);
            }
            const visualStateRef = value.visualCapture?.visualStateRef;
            if (typeof visualStateRef === 'string' && visualStateRef) {
                const state = visualStates[visualStateRef] || {
                    signatureHash: value.visualCapture?.signatureHash || null,
                    firstSeenPath: path || null,
                    uses: 0,
                    captureModes: [],
                    reasons: [],
                    evidence: { panelImageRef: null, viewportImageRef: null, canvasImageRefs: [] },
                };
                state.uses += 1;
                const mode = value.visualCapture?.requestedMode || value.visualCapture?.mode || null;
                const reason = value.visualCapture?.reason || null;
                if (mode && !state.captureModes.includes(mode)) state.captureModes.push(mode);
                if (reason && !state.reasons.includes(reason)) state.reasons.push(reason);
                state.evidence.panelImageRef ||= output.panelImage?.imageRef || null;
                state.evidence.viewportImageRef ||= output.viewportImage?.imageRef || null;
                (output.canvas || []).map(item => item?.imageRef).filter(Boolean).forEach(ref => {
                    if (!state.evidence.canvasImageRefs.includes(ref)) state.evidence.canvasImageRefs.push(ref);
                });
                visualStates[visualStateRef] = state;
            }
            return output;
        };

        return {
            compact,
            assets: () => ({
                policy: 'all-snapshots-deduplicated/v1',
                retainedImageBytes,
                retainedImages: Object.keys(images).length,
                omittedImages: 0,
                images,
                retainedDomSnapshots: Object.keys(domSnapshots).length,
                domSnapshots,
                retainedDiagnosticEvents: Object.keys(diagnosticEvents).length,
                diagnosticEvents,
                retainedPerformanceResources: Object.keys(performanceResources).length,
                performanceResources,
            }),
            visualStates: () => visualStates,
        };
    }

    function flatten(snapshot) {
        return (snapshot?.results || []).flatMap((urlResult, urlIndex) =>
            (urlResult.tests || []).map((test, testIndex) => ({ urlResult, urlIndex, test, testIndex }))
        );
    }

    function prepareTest(test) {
        return test;
    }

    const imageHash = image => image?.hash
        || (typeof image?.dataUrl === 'string' ? `fnv1a-${hashText(image.dataUrl)}` : null);

    const imageAvailable = image => !!(image
        && ((typeof image.dataUrl === 'string' && image.dataUrl)
            || (typeof image.imageRef === 'string' && image.imageRef)));

    function snapshotEvidence(snapshot) {
        if (!snapshot || typeof snapshot !== 'object') return {
            captured: false, observed: false, panelImageHash: null, viewportImageHash: null, canvasHashes: [], combinedImageHash: null,
            panelImageCaptured: false, viewportImageCaptured: false, panelImageError: null, canvasCaptured: false,
            panelPixelStats: null, canvasPixelStats: null, semanticHash: null, semanticCaptured: false,
            visualStateRef: null, captureMode: null, blankCandidates: [],
        };
        const panelImageHash = imageHash(snapshot.panelImage);
        const viewportImageHash = imageHash(snapshot.viewportImage);
        const canvasHashes = (snapshot.canvas || []).map(imageHash).filter(Boolean);
        const pixelSources = [snapshot.panelImage, ...(snapshot.canvas || [])].filter(Boolean);
        const blankCandidates = pixelSources.map((image, index) => ({
            source: index === 0 && snapshot.panelImage ? 'panelImage' : `canvas-${snapshot.panelImage ? index : index + 1}`,
            hash: imageHash(image),
            width: image.width || null,
            height: image.height || null,
            pixelStats: image.pixelStats || null,
            nearlyUniform: Number.isFinite(image.pixelStats?.luminanceStdDev)
                ? image.pixelStats.luminanceStdDev < 1.25 : null,
        }));
        const semantic = {
            renderer: snapshot.renderer || null,
            chartSeriesCount: snapshot.chartSeriesCount ?? null,
            markers: snapshot.markers || null,
            legend: snapshot.legend || null,
            series: snapshot.series || null,
            thresholdDiagnostic: snapshot.thresholdDiagnostic || null,
            tools: snapshot.tools || null,
        };
        return {
            captured: imageAvailable(snapshot.panelImage)
                || imageAvailable(snapshot.viewportImage)
                || (snapshot.canvas || []).some(imageAvailable),
            observed: !!(panelImageHash || viewportImageHash || canvasHashes.length),
            panelImageCaptured: imageAvailable(snapshot.panelImage),
            viewportImageCaptured: imageAvailable(snapshot.viewportImage),
            panelImageError: snapshot.panelImage?.error || null,
            canvasCaptured: (snapshot.canvas || []).some(imageAvailable),
            panelImageHash,
            viewportImageHash,
            canvasHashes,
            combinedImageHash: hashText(JSON.stringify({ panelImageHash, viewportImageHash, canvasHashes })),
            semanticHash: hashText(JSON.stringify(semantic)),
            semanticCaptured: true,
            visualStateRef: snapshot.visualCapture?.visualStateRef || null,
            captureMode: snapshot.visualCapture?.requestedMode || snapshot.visualCapture?.mode || null,
            panelPixelStats: snapshot.panelImage?.pixelStats || null,
            canvasPixelStats: (snapshot.canvas || []).find(image => image?.pixelStats)?.pixelStats || null,
            primaryPixelStats: pixelSources.find(image => image?.pixelStats)?.pixelStats || null,
            blankCandidates,
        };
    }

    function comparePixelStats(before, after) {
        if (!before || !after) return null;
        const beforeHistogram = before.histogram16 || [];
        const afterHistogram = after.histogram16 || [];
        const beforeSamples = Math.max(1, before.samples || beforeHistogram.reduce((sum, value) => sum + value, 0));
        const afterSamples = Math.max(1, after.samples || afterHistogram.reduce((sum, value) => sum + value, 0));
        const histogramDistance = Array.from({ length: Math.max(beforeHistogram.length, afterHistogram.length, 16) })
            .reduce((sum, _, index) => sum + Math.abs(
                (beforeHistogram[index] || 0) / beforeSamples - (afterHistogram[index] || 0) / afterSamples
            ), 0) / 2;
        const beforeOpaque = before.opaqueRatio ?? (1 - (before.transparentRatio || 0));
        const afterOpaque = after.opaqueRatio ?? (1 - (after.transparentRatio || 0));
        return {
            histogramDistance: Number(histogramDistance.toFixed(6)),
            luminanceMeanDelta: Number(((after.luminanceMean || 0) - (before.luminanceMean || 0)).toFixed(3)),
            luminanceStdDevDelta: Number(((after.luminanceStdDev || 0) - (before.luminanceStdDev || 0)).toFixed(3)),
            opaqueRatioDelta: Number((afterOpaque - beforeOpaque).toFixed(6)),
        };
    }

    function activeFeatures(settings) {
        const visual = settings?.visualSettings || {};
        const transform = settings?.transformSettings || {};
        const features = [];
        if (visual.removeFill) features.push('removeFill');
        if (visual.thickenLines) features.push('thickenLines');
        if (visual.invertLegend) features.push('invertLegend');
        if (settings?.legendVisibility && Object.values(settings.legendVisibility).some(value => value === false)) features.push('seriesVisibility');
        if (transform.invertIdle) features.push('invertIdle');
        if (transform.convertMemToUsed) features.push('convertMemToUsed');
        if (transform.seriesQueryFilterEnabled) features.push('seriesQueryFilter');
        if (transform.thresholdEnabled) features.push('thresholdEnabled');
        return features;
    }

    function transitionEvidenceRequirement(step) {
        if (['canvas', 'panel', 'forensic'].includes(step?.visualEvidenceRequirement)) {
            return step.visualEvidenceRequirement === 'forensic' ? 'forensic' : step.visualEvidenceRequirement;
        }
        const settings = step?.settings || {};
        const visual = settings.visualSettings || {};
        const transform = settings.transformSettings || {};
        const active = activeFeatures(settings);
        const panelRequired = active.some(feature => [
            'invertLegend', 'seriesVisibility', 'seriesQueryFilter', 'invertIdle', 'convertMemToUsed',
        ].includes(feature))
            || Object.prototype.hasOwnProperty.call(visual, 'invertLegend')
            || Object.prototype.hasOwnProperty.call(settings, 'legendVisibility')
            || Object.prototype.hasOwnProperty.call(transform, 'seriesQueryFilterEnabled')
            || Object.prototype.hasOwnProperty.call(transform, 'invertIdle')
            || Object.prototype.hasOwnProperty.call(transform, 'convertMemToUsed');
        return panelRequired ? 'panel' : 'canvas';
    }

    function evidenceSatisfied(evidence, requirement) {
        if (!evidence?.semanticCaptured) return false;
        if (requirement === 'semantic') return true;
        if (requirement === 'canvas') return evidence.canvasCaptured;
        if (requirement === 'panel') return evidence.panelImageCaptured && evidence.canvasCaptured;
        if (requirement === 'forensic') {
            return evidence.viewportImageCaptured && evidence.panelImageCaptured && evidence.canvasCaptured;
        }
        return false;
    }

    function hasProvenSemanticThresholdToggle(step, before, after, semanticChanged) {
        const changedIds = step?.changedIds;
        if (!Array.isArray(changedIds) || changedIds.length !== 1 || changedIds[0] !== 'thresholdEnabled') return false;
        if (step?.invariant?.pass !== true || semanticChanged !== true) return false;
        const beforeEnabled = before?.thresholdDiagnostic?.enabled ?? before?.tools?.thresholdEnabled ?? null;
        const afterEnabled = after?.thresholdDiagnostic?.enabled ?? after?.tools?.thresholdEnabled ?? null;
        const beforeEngine = before?.markers?.thresholdEngine ?? null;
        const afterEngine = after?.markers?.thresholdEngine ?? null;
        return beforeEnabled !== afterEnabled || beforeEngine !== afterEngine;
    }

    function buildVisualAudit(test) {
        if (test?.visualAudit?.policy === 'all-phases-visual-and-semantic-evidence/v1') return test.visualAudit;
        const diagnostic = test?.diagnostic || {};
        const outcome = outcomeOf(test);
        const executed = outcome !== 'not-run';
        const skipped = outcome === 'skip';
        const phases = [];
        const isTransition = Array.isArray(diagnostic.transitions);
        const addPhase = (phase, snapshot, required = true, requirement = 'semantic') => {
            const evidence = snapshotEvidence(snapshot);
            phases.push({
                phase,
                required,
                requirement,
                satisfied: !required || evidenceSatisfied(evidence, requirement),
                ...evidence,
            });
        };
        addPhase('external-before', diagnostic.before, executed, 'semantic');
        addPhase('scenario-opened', diagnostic.opened, isTransition, 'semantic');
        addPhase('scenario-baseline', diagnostic.baseline, isTransition, skipped ? 'semantic' : 'panel');
        (diagnostic.transitions || []).forEach((step, index) => {
            addPhase(`transition-${index + 1}-before`, step.before, true, 'semantic');
            addPhase(`transition-${index + 1}-after-command-before-refresh`, step.command?.afterCommandBeforeRefresh, true, 'semantic');
            if (step.persistence?.required || step.command?.persistence?.required) {
                addPhase(`transition-${index + 1}-after-first-refresh`,
                    step.persistence?.beforeRefresh || step.command?.persistence?.beforeRefresh, true, 'semantic');
            }
            addPhase(`transition-${index + 1}-after`, step.after, true, transitionEvidenceRequirement(step));
        });
        addPhase('external-after', diagnostic.after, executed, outcome === 'fail' ? 'forensic' : 'semantic');
        const resetRequired = isTransition && !skipped;
        addPhase('reset-after-command-before-refresh', diagnostic.reset?.command?.afterCommandBeforeRefresh, resetRequired, 'semantic');
        addPhase('reset-after', diagnostic.reset?.after, resetRequired,
            diagnostic.reset?.pass === false ? 'forensic' : 'panel');

        let previousFeatures = [];
        const transitions = (diagnostic.transitions || []).map((step, index) => {
            const before = snapshotEvidence(step.before);
            const after = snapshotEvidence(step.after);
            const persistence = step.persistence || step.command?.persistence || null;
            const afterFirstRefresh = snapshotEvidence(persistence?.beforeRefresh);
            const features = activeFeatures(step.settings);
            const activeSetChanged = JSON.stringify([...previousFeatures].sort()) !== JSON.stringify([...features].sort());
            previousFeatures = features;
            const imageChanged = before.canvasHashes.length && after.canvasHashes.length
                ? JSON.stringify(before.canvasHashes) !== JSON.stringify(after.canvasHashes)
                : (before.panelImageHash && after.panelImageHash
                    ? before.panelImageHash !== after.panelImageHash
                    : (before.viewportImageHash && after.viewportImageHash
                        ? before.viewportImageHash !== after.viewportImageHash : null));
            const semanticChanged = before.semanticHash && after.semanticHash
                ? before.semanticHash !== after.semanticHash : null;
            const provenSemanticThresholdToggle = hasProvenSemanticThresholdToggle(step, step.before, step.after, semanticChanged);
            const comparablePixels = before.panelPixelStats && after.panelPixelStats
                ? { source: 'panelImage', before: before.panelPixelStats, after: after.panelPixelStats }
                : (before.canvasPixelStats && after.canvasPixelStats
                    ? { source: 'canvas', before: before.canvasPixelStats, after: after.canvasPixelStats }
                    : null);
            const pixelDelta = comparablePixels
                ? comparePixelStats(comparablePixels.before, comparablePixels.after) : null;
            const issues = [];
            const requiredAfterEvidence = transitionEvidenceRequirement(step);
            if (!before.semanticCaptured) issues.push('missing-before-semantic-evidence');
            if (!evidenceSatisfied(after, requiredAfterEvidence)) issues.push(`missing-after-${requiredAfterEvidence}-evidence`);
            if (activeSetChanged && features.length && imageChanged === false && !provenSemanticThresholdToggle) {
                issues.push('changed-active-set-without-image-change');
            }
            if (!activeSetChanged && imageChanged === true && pixelDelta
                && (pixelDelta.histogramDistance > 0.05 || Math.abs(pixelDelta.luminanceMeanDelta) > 5)) {
                issues.push('idempotent-repeat-large-visual-change');
            }
            if (step?.verdict?.outcome === 'pass' && step?.invariant?.pass === false) issues.push('pass-with-failed-invariant');
            if (step?.verdict?.outcome === 'pass' && features.length && semanticChanged === false) issues.push('pass-without-semantic-state-change');
            if (persistence?.required && !afterFirstRefresh.semanticCaptured) issues.push('missing-after-first-refresh-semantic-evidence');
            if (persistence?.required && persistence.passed !== true) issues.push('active-state-not-proven-after-second-refresh');
            if (after.blankCandidates.some(candidate => candidate.nearlyUniform === true)) issues.push('after-image-nearly-uniform');
            return {
                index: index + 1,
                label: step.label || '',
                activeFeatures: features,
                activeSetChanged,
                settings: step.settings || null,
                outcome: step?.verdict?.outcome || null,
                before,
                after,
                persistence: persistence ? {
                    required: !!persistence.required,
                    status: persistence.status || null,
                    passed: persistence.passed === true,
                    reason: persistence.reason || '',
                    afterFirstRefresh,
                    afterSecondRefresh: after,
                    imageChangedAcrossSecondRefresh: afterFirstRefresh.captured && after.captured
                        ? afterFirstRefresh.combinedImageHash !== after.combinedImageHash : null,
                    semanticChangedAcrossSecondRefresh: afterFirstRefresh.semanticHash && after.semanticHash
                        ? afterFirstRefresh.semanticHash !== after.semanticHash : null,
                } : null,
                imageChanged,
                semanticChanged,
                provenSemanticThresholdToggle,
                pixelComparisonSource: comparablePixels?.source || null,
                pixelDelta,
                issues,
            };
        });
        const missingPhases = phases.filter(phase => phase.required && !phase.satisfied).map(phase => phase.phase);
        const issues = transitions.flatMap(transition => transition.issues.map(code => ({ transition: transition.index, code })));
        missingPhases.forEach(phase => issues.push({ transition: null, code: 'missing-required-visual-phase', phase }));
        if (test?.diagnostic?.captureErrors) issues.push({ transition: null, code: 'diagnostic-capture-error' });
        return {
            policy: 'all-phases-visual-and-semantic-evidence/v1',
            complete: missingPhases.length === 0,
            missingPhases,
            phases,
            transitions,
            issues,
            suspicious: outcomeOf(test) === 'pass' && issues.length > 0,
        };
    }

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

    function createArtifactContext(snapshot, metadata = {}) {
        const entries = flatten(snapshot);
        const derived = {
            passed: entries.filter(entry => outcomeOf(entry.test) === 'pass').length,
            failed: entries.filter(entry => outcomeOf(entry.test) === 'fail').length,
            skipped: entries.filter(entry => outcomeOf(entry.test) === 'skip').length,
            abortedNotRun: entries.filter(entry => outcomeOf(entry.test) === 'not-run').length,
        };
        const planned = snapshot.planned ?? snapshot.total ?? entries.length;
        const completed = snapshot.completed ?? snapshot.done ?? (derived.passed + derived.failed + derived.skipped);
        const reconciliation = {
            valid: planned === completed + derived.abortedNotRun
                && derived.passed === (snapshot.passed || 0)
                && derived.failed === (snapshot.failed || 0)
                && derived.skipped === (snapshot.skipped || 0),
            equation: `${planned} planned = ${completed} completed + ${derived.abortedNotRun} not-run`,
            declared: {
                passed: snapshot.passed || 0,
                failed: snapshot.failed || 0,
                skipped: snapshot.skipped || 0,
                abortedNotRun: snapshot.abortedNotRun || 0,
            },
            derived,
        };
        const analysis = buildAnalysis(snapshot, entries, reconciliation);
        return {
            schema: SCHEMA,
            exportedAt: metadata.exportedAt || new Date().toISOString(),
            exportedAtLocal: metadata.exportedAtLocal || null,
            timeZone: metadata.timeZone || null,
            generator: {
                name: 'DashBridge Test Runner',
                extensionVersion: metadata.extensionVersion || null,
                userAgent: metadata.userAgent || null,
                platform: metadata.platform || null,
            },
            summary: {
                runId: snapshot.runId || null,
                startedAt: snapshot.startedAt || null,
                finishedAt: snapshot.finishedAt || null,
                durationMs: snapshot.startedAt && snapshot.finishedAt
                    ? Math.max(0, snapshot.finishedAt - snapshot.startedAt) : null,
                mode: snapshot.mode || 'fast',
                total: snapshot.total ?? planned,
                planned,
                scheduled: snapshot.scheduled ?? 0,
                started: snapshot.started ?? completed,
                completed,
                abortedNotRun: snapshot.abortedNotRun ?? derived.abortedNotRun,
                passed: snapshot.passed || 0,
                failed: snapshot.failed || 0,
                skipped: snapshot.skipped || 0,
                aborted: !!snapshot.aborted,
                reconciliation,
            },
            capturePolicy: {
                mode: 'adaptive-visual-evidence/v1',
                semanticCheckpoints: 'fresh-at-every-phase',
                visualStates: 'content-addressed-and-deduplicated',
                viewport: 'url-bookends-and-automatic-forensic-failures',
                panel: 'baseline-layout-series-and-reset-evidence',
                canvas: 'distinct-user-visible-canvas-states',
                forensicEscalation: 'automatic-on-transition-reset-runtime-or-test-failure',
            },
            analysis,
            aiIndex: {
                verdict: analysis.verdict,
                primaryFailure: analysis.primaryFailure,
                failureClusters: analysis.failureClusters,
                suspiciousPasses: analysis.suspiciousPasses,
                visualEvidenceCoverage: analysis.visualEvidenceCoverage,
                recommendedVisualReview: [
                    ...(analysis.primaryFailure ? [{ testId: analysis.primaryFailure.testId, reason: analysis.primaryFailure.reasonCode }] : []),
                    ...analysis.suspiciousPasses.map(item => ({
                        testId: item.testId,
                        transitions: item.issues.map(issue => issue.transition).filter(Boolean),
                        reason: 'suspicious-pass',
                    })),
                ],
            },
        };
    }

    function createArtifactStreamPlan(snapshot, metadata = {}) {
        const prelude = createArtifactContext(snapshot, metadata);
        const compactor = createCompactor();
        return {
            prelude,
            sourceResults: snapshot.results || [],
            compactUrlMetadata(urlResult) {
                return compactor.compact(
                    Object.fromEntries(Object.entries(urlResult || {}).filter(([key]) => key !== 'tests')),
                    { path: 'urlResult' }
                );
            },
            compactTest(test) {
                const outcome = outcomeOf(test);
                return compactor.compact({
                    ...prepareTest(test),
                    outcome,
                    reasonCode: reasonCodeOf(test),
                    shortReason: shortReason(test),
                    visualAudit: buildVisualAudit(test),
                }, { path: 'test' });
            },
            assets: compactor.assets,
            visualStates: compactor.visualStates,
        };
    }

    // Compact one independently disposable unit. The returned asset payloads
    // are intentionally scoped to this call so a disk-backed consumer can
    // persist them and release both the raw test and the temporary registry
    // before the next test starts.
    function createTestAnalysisUnit(test, url = '') {
        const outcome = outcomeOf(test);
        const completed = outcome === 'not-run' ? 0 : 1;
        const notRun = outcome === 'not-run' ? 1 : 0;
        const snapshot = {
            planned: 1, total: 1, completed, done: completed,
            passed: outcome === 'pass' ? 1 : 0,
            failed: outcome === 'fail' ? 1 : 0,
            skipped: outcome === 'skip' ? 1 : 0,
            abortedNotRun: notRun,
            results: [{ url, tests: [test] }],
        };
        const reconciliation = {
            valid: true,
            equation: `1 planned = ${completed} completed + ${notRun} not-run`,
            declared: { passed: snapshot.passed, failed: snapshot.failed, skipped: snapshot.skipped, abortedNotRun: notRun },
            derived: { passed: snapshot.passed, failed: snapshot.failed, skipped: snapshot.skipped, abortedNotRun: notRun },
        };
        return buildAnalysis(snapshot, flatten(snapshot), reconciliation);
    }

    function createTestArtifact(test, { url = '' } = {}) {
        const compactor = createCompactor();
        const analysisUnit = createTestAnalysisUnit(test, url);
        const compacted = compactor.compact({
            ...prepareTest(test),
            outcome: outcomeOf(test),
            reasonCode: reasonCodeOf(test),
            shortReason: shortReason(test),
            visualAudit: buildVisualAudit(test),
        }, { path: 'test' });
        return { value: compacted, analysisUnit, assets: compactor.assets(), visualStates: compactor.visualStates() };
    }

    function createUrlMetadataArtifact(urlResult) {
        const compactor = createCompactor();
        const metadata = Object.fromEntries(Object.entries(urlResult || {}).filter(([key]) => key !== 'tests'));
        return {
            value: compactor.compact(metadata, { path: 'urlResult' }),
            assets: compactor.assets(),
            visualStates: compactor.visualStates(),
        };
    }

    function buildArtifact(snapshot, metadata = {}) {
        const plan = createArtifactStreamPlan(snapshot, metadata);
        const results = plan.sourceResults.map(urlResult => ({
            ...plan.compactUrlMetadata(urlResult),
            tests: (urlResult.tests || []).map(test => plan.compactTest(test)),
        }));
        return { ...plan.prelude, results, visualStates: plan.visualStates(), assets: plan.assets() };
    }

    return {
        SCHEMA, buildArtifact, createArtifactStreamPlan, createTestArtifact, createUrlMetadataArtifact,
        outcomeOf, reasonCodeOf, buildVisualAudit, snapshotEvidence,
    };
})();
