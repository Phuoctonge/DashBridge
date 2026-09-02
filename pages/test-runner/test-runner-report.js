// Test Runner lossless-evidence artifact facade.

'use strict';

const DashBridgeTestReport = (() => {
    const visualAudit = globalThis.DashBridgeTestVisualAudit;
    const reportAnalysis = globalThis.DashBridgeTestReportAnalysis;
    if (!visualAudit?.buildVisualAudit || !reportAnalysis?.buildAnalysis) {
        throw new Error('Test report dependencies must load before DashBridgeTestReport');
    }
    const {
        outcomeOf,
        reasonCodeOf,
        shortReason,
        hashText,
        buildVisualAudit,
        snapshotEvidence,
    } = visualAudit;
    const { buildAnalysis } = reportAnalysis;
    const SCHEMA = 'dashbridge-e2e-diagnostics/v4';

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
                selection: snapshot.selection || { scope: 'all', ids: [] },
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
