'use strict';

// Streams a multi-gigabyte minified DashBridge artifact and materialises only
// explicitly requested test objects. Usage:
// node test/analyze_e2e_diagnostics_slice.js report.json H8_1,HP1_1

const fs = require('fs');

const file = process.argv[2];
const wanted = new Set(String(process.argv[3] || '').split(',').map(value => value.trim()).filter(Boolean));
const reasonsOnly = process.argv.includes('--reasons');
const phasesOnly = process.argv.includes('--phases');
const axesOnly = process.argv.includes('--axes');
const auditOnly = process.argv.includes('--audit');
if (!file || !wanted.size) {
    console.error('Usage: node test/analyze_e2e_diagnostics_slice.js <report.json> <id,id,...>');
    process.exit(2);
}

const patterns = new Map([...wanted].map(id => [id, `{"id":"${id}","category":`]));
const maxPattern = Math.max(...[...patterns.values()].map(value => value.length));
const fd = fs.openSync(file, 'r');
const chunk = Buffer.alloc(4 * 1024 * 1024);
let position = 0;
let carry = '';
let capturing = null;
let captureParts = [];
let depth = 0;
let inString = false;
let escaped = false;
const found = [];

const summarizeTools = tools => tools ? ({
    targetPanelId: tools.targetPanelId ?? null,
    thresholdEnabled: tools.thresholdEnabled ?? null,
    thresholdValue: tools.thresholdValue ?? null,
    thresholdRawValue: tools.thresholdRawValue ?? null,
    seriesQueryFilterEnabled: tools.seriesQueryFilterEnabled ?? null,
    removeFill: tools.removeFill ?? null,
    thickenLines: tools.thickenLines ?? null,
    invertLegend: tools.invertLegend ?? null,
    invertIdle: tools.invertIdle ?? null,
    convertMemToUsed: tools.convertMemToUsed ?? null,
    legendVisibilityCount: tools.legendVisibility && typeof tools.legendVisibility === 'object'
        ? Object.keys(tools.legendVisibility).length : 0,
}) : null;

const summarizeMarkers = markers => markers ? ({
    thresholdApplied: markers.thresholdApplied ?? markers.threshold ?? null,
    thresholdEngine: markers.thresholdEngine ?? null,
    visibilityEntryCount: Array.isArray(markers.visibilityEntries) ? markers.visibilityEntries.length : 0,
    hiddenVisibilityCount: Array.isArray(markers.visibilityEntries)
        ? markers.visibilityEntries.filter(entry => entry?.hidden || entry?.dimmed || entry?.nativeHidden || entry?.visuallyHidden).length
        : 0,
    fillRemovedCount: markers.fillRemovedCount ?? null,
    thickenedLineCount: markers.thickenedLineCount ?? null,
    invertedLegendCount: markers.invertedLegendCount ?? null,
}) : null;

const summarizeInterceptor = interceptor => interceptor ? ({
    at: interceptor.at ?? null,
    scope: interceptor.scope ?? null,
    beforeSeries: interceptor.beforeSeries ?? null,
    afterSeries: interceptor.afterSeries ?? null,
    sourceFilterEnabled: interceptor.sourceFilterEnabled ?? null,
    sourceFilter: interceptor.sourceFilter ?? null,
}) : null;

const summarizeDebug = debug => {
    if (!debug) return '';
    try {
        const value = JSON.parse(debug);
        if (Array.isArray(value)) return {
            arrayLength: value.length,
            widths: [...new Set(value.map(item => `${item?.originalWidth}->${item?.width}`))],
            fills: [...new Set(value.map(item => `${item?.originalFill}->${item?.fill}`))],
            shows: [...new Set(value.map(item => item?.show))],
        };
        return value;
    } catch (_) {
        return debug.length > 2000 ? `${debug.slice(0, 2000)}…[${debug.length} chars]` : debug;
    }
};

const summarizeInvariant = invariant => invariant ? ({
    pass: invariant.pass,
    skip: invariant.skip,
    reason: invariant.reason,
    debug: summarizeDebug(invariant.debug),
}) : null;

const summarizeVisualReapply = diagnostic => diagnostic ? ({
    requested: diagnostic.requested ?? null,
    completed: diagnostic.completed ?? null,
    cancelled: diagnostic.cancelled ?? null,
    errors: diagnostic.errors ?? null,
    settleInspections: diagnostic.settleInspections ?? null,
    adaptiveReapplies: diagnostic.adaptiveReapplies ?? null,
    rendererReplacements: diagnostic.rendererReplacements ?? null,
    styleDrifts: diagnostic.styleDrifts ?? null,
    settleTimeouts: diagnostic.settleTimeouts ?? null,
    lastError: diagnostic.lastError ?? null,
    recentEvents: (diagnostic.events || []).slice(-12).map(event => ({
        id: event.id,
        at: event.at,
        stage: event.stage,
        panelId: event.panelId ?? null,
        targetRootClass: event.targetRootClass ?? null,
        generation: event.generation ?? null,
        attempt: event.attempt ?? null,
        engineResult: event.engineResult ?? null,
        styleState: event.styleState ?? null,
        reason: event.reason ?? null,
        queryEventId: event.queryEventId ?? null,
        queryRequestId: event.queryRequestId ?? null,
    })),
}) : null;

const summarizeSnapshot = snapshot => ({
    at: snapshot?.at || null,
    panelFound: snapshot?.panelFound ?? null,
    renderer: snapshot?.renderer || null,
    tools: summarizeTools(snapshot?.tools),
    markers: summarizeMarkers(snapshot?.markers),
    thresholdDiagnostic: snapshot?.thresholdDiagnostic || null,
    visualStyleState: snapshot?.visualStyleState || null,
    legacyVisualObserver: snapshot?.legacyVisualObserverDiagnostic || null,
    visualReapply: summarizeVisualReapply(snapshot?.visualReapplyDiagnostic),
    seriesSummary: Array.isArray(snapshot?.series) ? {
        count: snapshot.series.length,
        fillDisabled: snapshot.series.filter(series => series?.fill === false).length,
        thickened: snapshot.series.filter(series => Number.isFinite(series?.width)
            && Number.isFinite(series?.originalWidth) && series.width > series.originalWidth).length,
        widthPairs: [...new Set(snapshot.series.map(series => `${series?.originalWidth}->${series?.width}`))],
    } : null,
    axes: (snapshot?.axes || []).map(axis => ({
        index: axis.index,
        scale: axis.scale,
        side: axis.side,
        size: axis.size,
        space: axis.space,
        found: axis.found,
    })),
    interceptorLast: summarizeInterceptor(snapshot?.interceptor?.last),
    panelHash: snapshot?.panelImage?.hash || snapshot?.panelImage?.imageRef || null,
    viewportHash: snapshot?.viewportImage?.hash || snapshot?.viewportImage?.imageRef || null,
    domHash: snapshot?.domSnapshot?.root?.outerHTMLHash || null,
});

const summarize = test => ({
    id: test.id,
    name: test.name,
    pass: test.pass,
    skip: test.skip,
    outcome: test.outcome,
    reasonCode: test.reasonCode,
    shortReason: test.shortReason,
    details: test.details,
    durationMs: test.durationMs,
    visualIssues: test.visualAudit?.issues || [],
    verdict: test.diagnostic?.verdict ? {
        outcome: test.diagnostic.verdict.outcome,
        functionalPass: test.diagnostic.verdict.functionalPass,
        runtimePass: test.diagnostic.verdict.runtimePass,
        reason: test.diagnostic.verdict.reason,
    } : null,
    baseline: summarizeSnapshot(test.diagnostic?.baseline),
    transitions: (test.diagnostic?.transitions || []).map(step => ({
        index: step.index,
        label: step.label,
        activeIds: step.activeIds,
        settings: step.settings,
        commandStatus: step.command?.status,
        acknowledgement: step.command?.acknowledgement || null,
        lifecycleStatus: step.lifecycle?.status || step.command?.lifecycle?.status || null,
        settlementStatus: step.settlement?.status || step.command?.settlement?.status || null,
        persistence: step.persistence ? {
            status: step.persistence.status,
            passed: step.persistence.passed,
            reason: step.persistence.reason,
        } : null,
        invariant: summarizeInvariant(step.invariant),
        verdict: step.verdict,
        before: summarizeSnapshot(step.before),
        afterCommand: summarizeSnapshot(step.command?.afterCommandBeforeRefresh),
        afterFirstRefresh: summarizeSnapshot(step.persistence?.beforeRefresh),
        after: summarizeSnapshot(step.after),
    })),
    beforeReset: summarizeSnapshot(test.diagnostic?.beforeReset),
    reset: test.diagnostic?.reset ? {
        commandStatus: test.diagnostic.reset.command?.status,
        lifecycleStatus: test.diagnostic.reset.lifecycle?.status,
        settlementStatus: test.diagnostic.reset.settlement?.status,
        nativeLegend: test.diagnostic.reset.nativeLegend,
        invariant: summarizeInvariant(test.diagnostic.reset.invariant),
        verdict: test.diagnostic.reset.verdict,
        afterCommand: summarizeSnapshot(test.diagnostic.reset.command?.afterCommandBeforeRefresh),
        after: summarizeSnapshot(test.diagnostic.reset.after),
    } : null,
});

const finishCapture = text => {
    const test = JSON.parse(text);
    if (auditOnly) {
        const transitions = test.diagnostic?.transitions || [];
        const persistenceRequired = transitions.filter(step => step.persistence?.required === true);
        found.push({
            id: test.id,
            outcome: test.outcome,
            pass: test.pass === true,
            skip: test.skip === true,
            transitions: transitions.length,
            failedInvariants: transitions
                .filter(step => step.invariant?.pass !== true && step.invariant?.skip !== true)
                .map(step => ({ index: step.index, reason: step.invariant?.reason || '' })),
            failedPersistence: persistenceRequired
                .filter(step => step.persistence?.passed !== true)
                .map(step => ({ index: step.index, status: step.persistence?.status || null, reason: step.persistence?.reason || '' })),
            resetPresent: !!test.diagnostic?.reset,
            resetPassed: test.diagnostic?.reset?.invariant?.pass === true,
            visualIssues: test.visualAudit?.issues?.length || 0,
        });
        wanted.delete(test.id);
        patterns.delete(test.id);
        return;
    }
    const axisPhase = snapshot => snapshot ? ({
        at: snapshot.at || null,
        seriesCount: Array.isArray(snapshot.series) ? snapshot.series.length : null,
        canvas: (snapshot.canvas || []).map(item => ({
            width: item.width,
            height: item.height,
            hash: item.hash || item.imageRef || null,
        })),
        legendDirection: snapshot.legend?.position?.direction || null,
        sourceFilterEnabled: snapshot.tools?.seriesQueryFilterEnabled ?? null,
        axes: (snapshot.axes || []).map(axis => ({
            index: axis.index,
            scale: axis.scale,
            size: axis.size,
            space: axis.space,
            increment: Array.isArray(axis.found) ? axis.found[0] : null,
            resolvedSpace: Array.isArray(axis.found) ? axis.found[1] : null,
        })),
    }) : null;
    const phase = snapshot => ({
        at: snapshot?.at || null,
        tools: summarizeTools(snapshot?.tools),
        seriesSummary: Array.isArray(snapshot?.series) ? {
            count: snapshot.series.length,
            fillDisabled: snapshot.series.filter(series => series?.fill === false).length,
            thickened: snapshot.series.filter(series => Number.isFinite(series?.width)
                && Number.isFinite(series?.originalWidth) && series.width > series.originalWidth).length,
            widthPairs: [...new Set(snapshot.series.map(series => `${series?.originalWidth}->${series?.width}`))],
        } : null,
        axes: (snapshot?.axes || []).map(axis => ({
            index: axis.index,
            scale: axis.scale,
            side: axis.side,
            size: axis.size,
            space: axis.space,
            found: axis.found,
        })),
        visualReapply: snapshot?.visualReapplyDiagnostic ? {
            requested: snapshot.visualReapplyDiagnostic.requested,
            completed: snapshot.visualReapplyDiagnostic.completed,
            cancelled: snapshot.visualReapplyDiagnostic.cancelled,
            errors: snapshot.visualReapplyDiagnostic.errors,
            settleInspections: snapshot.visualReapplyDiagnostic.settleInspections,
            adaptiveReapplies: snapshot.visualReapplyDiagnostic.adaptiveReapplies,
            rendererReplacements: snapshot.visualReapplyDiagnostic.rendererReplacements,
            styleDrifts: snapshot.visualReapplyDiagnostic.styleDrifts,
            settleTimeouts: snapshot.visualReapplyDiagnostic.settleTimeouts,
            recentEvents: (snapshot.visualReapplyDiagnostic.events || []).slice(-5).map(event => ({
                id: event.id, at: event.at, stage: event.stage, generation: event.generation,
                attempt: event.attempt, panelId: event.panelId, engineResult: event.engineResult,
                styleState: event.styleState, reason: event.reason, queryEventId: event.queryEventId,
            })),
        } : null,
        legacyVisualObserver: snapshot?.legacyVisualObserverDiagnostic || null,
        interceptorAt: snapshot?.interceptor?.last?.at || null,
    });
    found.push(axesOnly ? {
        id: test.id,
        name: test.name,
        outcome: test.outcome,
        baseline: axisPhase(test.diagnostic?.baseline),
        transitions: (test.diagnostic?.transitions || []).map(step => ({
            index: step.index,
            label: step.label,
            activeIds: step.activeIds,
            before: axisPhase(step.before),
            afterCommand: axisPhase(step.command?.afterCommandBeforeRefresh),
            afterFirstRefresh: axisPhase(step.persistence?.beforeRefresh),
            afterSecondRefresh: axisPhase(step.after),
        })),
        reset: test.diagnostic?.reset ? {
            afterCommand: axisPhase(test.diagnostic.reset.command?.afterCommandBeforeRefresh),
            after: axisPhase(test.diagnostic.reset.after),
        } : null,
    } : phasesOnly ? {
        id: test.id,
        outcome: test.outcome,
        shortReason: test.shortReason,
        transitions: (test.diagnostic?.transitions || []).map(step => ({
            index: step.index,
            label: step.label,
            invariant: summarizeInvariant(step.invariant),
            before: phase(step.before),
            afterCommand: phase(step.command?.afterCommandBeforeRefresh),
            afterFirstRefresh: phase(step.persistence?.beforeRefresh),
            after: phase(step.after),
        })),
    } : reasonsOnly ? {
        id: test.id,
        name: test.name,
        outcome: test.outcome,
        reasonCode: test.reasonCode,
        shortReason: test.shortReason,
        transitions: (test.diagnostic?.transitions || []).map(step => ({
            index: step.index,
            label: step.label,
            activeIds: step.activeIds,
            invariant: summarizeInvariant(step.invariant),
        })),
        reset: summarizeInvariant(test.diagnostic?.reset?.invariant),
    } : summarize(test));
    wanted.delete(test.id);
    patterns.delete(test.id);
};

const feedCapture = segment => {
    let end = -1;
    for (let index = 0; index < segment.length; index += 1) {
        const char = segment[index];
        if (inString) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') inString = false;
            continue;
        }
        if (char === '"') { inString = true; continue; }
        if (char === '{' || char === '[') depth += 1;
        else if (char === '}' || char === ']') {
            depth -= 1;
            if (depth === 0) { end = index; break; }
        }
    }
    if (end < 0) {
        captureParts.push(segment);
        return '';
    }
    captureParts.push(segment.slice(0, end + 1));
    finishCapture(captureParts.join(''));
    capturing = null;
    captureParts = [];
    depth = 0;
    inString = false;
    escaped = false;
    return segment.slice(end + 1);
};

while (wanted.size) {
    const bytes = fs.readSync(fd, chunk, 0, chunk.length, position);
    if (!bytes) break;
    position += bytes;
    let data = carry + chunk.subarray(0, bytes).toString('utf8');
    carry = '';
    while (data && wanted.size) {
        if (capturing) {
            data = feedCapture(data);
            continue;
        }
        let earliest = null;
        for (const [id, pattern] of patterns) {
            const index = data.indexOf(pattern);
            if (index >= 0 && (!earliest || index < earliest.index)) earliest = { id, index };
        }
        if (!earliest) {
            carry = data.slice(-maxPattern);
            data = '';
            continue;
        }
        capturing = earliest.id;
        depth = 0;
        inString = false;
        escaped = false;
        data = feedCapture(data.slice(earliest.index));
    }
}
fs.closeSync(fd);

const audit = auditOnly ? {
    tests: found.length,
    pass: found.filter(test => test.outcome === 'pass').length,
    skip: found.filter(test => test.outcome === 'skip').length,
    fail: found.filter(test => test.outcome === 'fail').length,
    transitionCount: found.reduce((total, test) => total + test.transitions, 0),
    failedInvariants: found.flatMap(test => test.failedInvariants.map(item => ({ testId: test.id, ...item }))),
    failedPersistence: found.flatMap(test => test.failedPersistence.map(item => ({ testId: test.id, ...item }))),
    failedResets: found.filter(test => test.resetPresent && !test.resetPassed).map(test => test.id),
    visualIssues: found.filter(test => test.visualIssues > 0).map(test => ({ testId: test.id, count: test.visualIssues })),
} : null;
console.log(JSON.stringify({ bytesScanned: position, requested: [...new Set(String(process.argv[3]).split(','))], missing: [...wanted], ...(audit ? { audit } : { tests: found }) }, null, 2));
