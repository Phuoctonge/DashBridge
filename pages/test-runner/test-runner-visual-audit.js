(function initDashBridgeTestVisualAudit(root) {
    'use strict';
    if (root.DashBridgeTestVisualAudit) return;

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

    root.DashBridgeTestVisualAudit = Object.freeze({
        outcomeOf,
        reasonCodeOf,
        shortReason,
        hashText,
        imageAvailable,
        snapshotEvidence,
        activeFeatures,
        buildVisualAudit,
    });
})(globalThis);
