'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'content', 'grafana-visual-engine.js'), 'utf8');
const panelToolsSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'content', 'grafana-panel-tools.js'), 'utf8');
const helperStart = source.indexOf('const removeThresholdHighlightOverlays');
const helperEnd = source.indexOf('    const normalizeHighlightName', helperStart);
assert(helperStart >= 0 && helperEnd > helperStart,
    'global threshold-overlay cleanup helper must remain independently testable');

const staleDashboardOverlay = { removed: false, remove() { this.removed = true; } };
const currentViewOverlay = { removed: false, remove() { this.removed = true; } };
let selector = null;
const context = {
    document: {
        querySelectorAll(value) {
            selector = value;
            return [staleDashboardOverlay, currentViewOverlay];
        }
    }
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(`${source.slice(helperStart, helperEnd)}
globalThis.removeOverlays = removeThresholdHighlightOverlays;
globalThis.rootIsActive = isThresholdHighlightRootActive;`, context);

context.removeOverlays();
assert.strictEqual(selector, '[data-dashbridge-threshold-highlights]');
assert.strictEqual(staleDashboardOverlay.removed, true,
    'opening View must remove the fixed overlay left by the compact dashboard plot');
assert.strictEqual(currentViewOverlay.removed, true,
    'redrawing must replace rather than stack threshold overlays');
assert.strictEqual(context.rootIsActive(context.document), true,
    'the document root remains a valid global lifecycle root');
assert.strictEqual(context.rootIsActive({ isConnected: false }), false,
    'a detached View root must never project another body-level overlay');
assert.strictEqual(context.rootIsActive({ isConnected: true, getClientRects: () => [] }), false,
    'a connected but hidden View root must be treated as inactive after close');
assert.strictEqual(context.rootIsActive({ isConnected: true, getClientRects: () => [{}] }), true,
    'a connected visible panel root remains renderable');

const renderStart = source.indexOf('const renderThresholdHighlights');
const renderEnd = source.indexOf('    const scheduleThresholdHighlightRender', renderStart);
const renderSource = source.slice(renderStart, renderEnd);
assert(renderSource.includes('removeThresholdHighlightOverlays();'),
    'every threshold render must clear body-level overlays before using current plot dimensions');
assert(renderSource.indexOf('removeThresholdHighlightOverlays();') < renderSource.indexOf('renderFlotThresholdHighlights(root, rules)'),
    'stale compact overlays must be removed before the View overlay is drawn');
assert(renderSource.includes('if (!isThresholdHighlightRootActive(root)'),
    'a detached or hidden View must stop after removing its stale fixed overlay');

const lifecycleStart = source.indexOf('const stopThresholdHighlightController');
const lifecycleEnd = source.indexOf('    const setThreshold', lifecycleStart);
const lifecycleSource = source.slice(lifecycleStart, lifecycleEnd);
assert(lifecycleSource.includes('controller.mutationObserver.observe(document.documentElement'),
    'View remounts must be observed outside the compact panel root');
assert(lifecycleSource.includes('if (pageLayoutChanged) {')
    && lifecycleSource.includes('controller.schedule();'),
    'a Grafana DOM transition must schedule projection against the current View geometry');
assert(lifecycleSource.includes('changedNodes.some(touchesLifecycleRoot)')
    && lifecycleSource.includes('childList: true')
    && !lifecycleSource.includes("attributeFilter: ['class', 'style', 'aria-selected', 'aria-pressed']"),
    'threshold remount observer must ignore unrelated per-frame Grafana style mutations');
assert(lifecycleSource.includes('window.__dashbridgeThresholdHighlightDiagnostic'),
    'runtime diagnostics must expose the current host and overlay geometry');
assert(lifecycleSource.includes("document.addEventListener('click', controller.lifecycleClickListener, true)")
    && lifecycleSource.includes("document.removeEventListener('click', controller.lifecycleClickListener, true)"),
    'a View close click must schedule one lifecycle render and its listener must be removable');
assert(lifecycleSource.includes('controller.lifecycleChecksRemaining = 24')
    && lifecycleSource.includes('controller.lifecycleChecksRemaining -= 1'),
    'View close must repaint through a bounded layout-settling window');
assert(lifecycleSource.includes("window.dispatchEvent(new Event('dashbridgeThresholdHighlightRootDetached'))"),
    'an inactive View root must request rebinding to the restored dashboard panel');
assert(panelToolsSource.includes("window.addEventListener?.('dashbridgeThresholdHighlightRootDetached'")
    && panelToolsSource.includes('rebindThresholdHighlightsAfterViewClose'),
    'panel tools must rebind threshold highlights immediately after View closes');

console.log('PASS threshold highlights replace stale overlays when Flot enters and leaves View');
