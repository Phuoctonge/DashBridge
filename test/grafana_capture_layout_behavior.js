'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = {};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/shared/grafana-capture-output.js', 'utf8'), context);
const capture = context.DashBridgeGrafanaCaptureOutput;

assert.deepStrictEqual(
    Array.from(Object.values(capture.normalizeOutputSize({ width: 1280, height: 720 }))),
    [1280, 720],
    'valid user dimensions must pass through unchanged'
);
assert.deepStrictEqual(
    Array.from(Object.values(capture.normalizeOutputSize({ width: 99, height: 100000 }))),
    [1000, 520],
    'untrusted capture dimensions must fall back to bounded defaults'
);

const wide = capture.fitPreparedSize({ viewportWidth: 1920, viewportHeight: 1080 });
assert(Math.abs(wide.width / wide.height - 1000 / 520) < 0.005);
assert.strictEqual(wide.width, 1000, 'prepared capture must render at the requested CSS width instead of downscaling a viewport-sized panel');
assert.strictEqual(wide.height, 520, 'prepared capture must render at the requested CSS height so labels retain their normal size');
const narrow = capture.fitPreparedSize({ viewportWidth: 700, viewportHeight: 500 });
assert(Math.abs(narrow.width / narrow.height - 1000 / 520) < 0.005, 'prepared capture must preserve aspect ratio');
assert(narrow.left >= 12 && narrow.top >= 12, 'prepared panel must stay inside the visible viewport');

const tools = fs.readFileSync('js/content/grafana-panel-tools.js', 'utf8')
    + fs.readFileSync('js/content/grafana-panel-capture-runtime.js', 'utf8')
    + fs.readFileSync('js/content/grafana-panel-menu-runtime.js', 'utf8');
const dashboard = fs.readFileSync('pages/dashbridge/dashbridge.js', 'utf8')
    + fs.readFileSync('pages/dashbridge/dashbridge-panel-card-controller.js', 'utf8')
    + fs.readFileSync('pages/dashbridge/dashbridge-page-ui-controller.js', 'utf8')
    + fs.readFileSync('pages/dashbridge/dashbridge-iframe-message-controller.js', 'utf8');
const dashboardCapture = fs.readFileSync('pages/dashbridge/dashbridge-capture.js', 'utf8');
const dashboardCss = ['dashbridge.css', 'dashbridge-dialogs.css', 'dashbridge-interactions.css', 'dashbridge-report.css']
    .map(file => fs.readFileSync(`pages/dashbridge/${file}`, 'utf8')).join('\n');
const dashboardHtml = fs.readFileSync('pages/dashbridge/dashbridge.html', 'utf8');
assert(tools.includes("await session?.restore?.()"), 'native capture must restore its temporary layout');
assert(tools.includes("classList.remove('dashbridge-panel-capture-mode')"), 'capture-only tooltip suppression must always be removed');
assert(tools.includes('html.dashbridge-panel-capture-mode [data-dashbridge-threshold-highlights] { z-index:2147483646 !important; }'),
    'threshold overlay must remain above the prepared capture frame');
assert(tools.includes('return { ...state, capturePrepared: defaultPanelCapturePrepared() }'), 'per-panel state must not override the global prepared-capture setting');
assert(tools.includes('syncAllPanelCaptureToggles(value)'), 'one toolbar click must update every visible panel toggle');
assert(dashboardCapture.includes('storage.set({ grafanaCompactScreenshot: prepared })'), 'DashBridge capture owner must persist the shared toggle globally');
assert(tools.includes('const fitPanelCaptureSize = options =>'), 'native prepared capture must survive a stale hot-injected dependency set');
assert(tools.includes("captureFrame.className = 'dashbridge-panel-capture-frame'"), 'native prepared capture must escape Grafana grid containment');
assert(tools.includes('const createCompactCaptureLegendBackgroundController = root =>')
    && tools.indexOf('captureLegendBackgroundController = createCompactCaptureLegendBackgroundController(captureNode);')
        < tools.indexOf('document.body.appendChild(captureFrame);'),
    'compact capture must freeze native alternating legend backgrounds before moving the panel');
assert(tools.includes('captureLegendBackgroundController.start();')
    && tools.includes('new MutationObserver(apply)')
    && tools.includes('captureLegendBackgroundController.apply();')
    && tools.includes('captureLegendBackgroundController?.restore();'),
    'compact capture must style replacement legend rows after resize and clean them up afterwards');
assert(tools.includes('const fallbackStripeBackground = `rgb(')
    && tools.includes("setTemporaryStyle(element, 'background-color', background)"),
    'compact capture must synthesize a visible opaque zebra stripe when Grafana exposes only one background color');
assert(tools.includes('const isNeutralBackground = value =>')
    && tools.includes('Math.max(...rgb) - Math.min(...rgb) <= 14')
    && tools.includes('.find(isNeutralBackground) || null'),
    'compact capture must not mistake coloured series swatches for legend row backgrounds');
assert(tools.includes('getLayoutRows().forEach(row =>')
    && tools.includes("setTemporaryStyle(cell, 'flex', '0 0 48px')")
    && tools.includes("setTemporaryStyle(cell, 'text-align', 'right')"),
    'compact bottom capture must align vCPU/min/max/current as four fixed numeric columns');
assert(tools.includes('syncThresholdHighlightState(captureFrame, captureVisualState)')
    && tools.includes('syncThresholdHighlightState(outer, captureVisualState)'),
    'legacy Flot threshold overlay must move into the capture root and return afterwards');
assert(tools.includes('captureAnchor.replaceWith(captureNode)'), 'native panel must return to its exact DOM position after capture');
assert(tools.includes('(captureFrame || outer).getBoundingClientRect()'), 'prepared capture must crop the isolated overlay instead of the Grafana viewport');
assert(tools.includes("outer.querySelector('.graph-panel')")
    && tools.includes('legacySnapshot?.forEach')
    && tools.includes('layout?.resizeUPlot(layoutTarget, layoutTarget)'),
    'native compact capture must resize and restore Grafana 10 legacy graph content instead of only its grid item');
assert(tools.includes("legacyGraphPanel.style.setProperty('height', `${legacyHeight}px`, 'important')")
    && tools.includes('captureFrame.appendChild(captureNode)')
    && tools.includes('layout?.redrawFlot(layoutTarget, true)'),
    'Grafana 10 legacy Flot panels must fill the prepared frame and redraw their plot and legend');
assert(tools.includes("captureTitle.className = 'dashbridge-panel-capture-legacy-title'")
    && tools.includes("- legacyTitleHeight"),
    'Grafana 10 legacy compact capture must preserve an external panel title and reserve space for it');
assert(tools.includes('const getVisualLegendFilter = state =>')
    && tools.includes('Array.isArray(state?.legendFilter)')
    && !tools.includes('next.legendFilter.includes(name)'),
    'legacy or partial visual state must not throw when legendFilter is absent');
assert(tools.includes('host.append(preparedToggle, download, copy)')
    && tools.includes('host.append(trigger)'), 'capture controls must keep the DashBridge settings icon on the far right');
assert(tools.includes("preparedToggle.appendChild(createPanelCaptureIcon('compact'))")
    && tools.includes("download.appendChild(createPanelCaptureIcon('download'))")
    && tools.includes("copy.appendChild(createPanelCaptureIcon('copy'))"),
    'capture controls must use stable, purpose-specific SVG icons instead of platform font glyphs');
assert(tools.includes("points: '12,7.25 17,7.25 17,12.25'")
    && tools.includes("points: '12,16.75 7,16.75 7,11.75'")
    && dashboardHtml.includes('points="12,7.25 17,7.25 17,12.25"')
    && dashboardHtml.includes('points="12,16.75 7,16.75 7,11.75"'),
    'compact capture icons must use prominent filled resize arrowheads in both hosts');
assert(tools.includes("'aria-hidden': 'true'") && tools.includes("focusable: 'false'")
    && tools.includes('.dashbridge-panel-capture-action:focus-visible'),
    'decorative capture icons must preserve accessible button labels and keyboard focus feedback');
assert(tools.includes("setAttribute('aria-pressed', String(enabled))"), 'prepared capture toggle must expose its current state');
assert(tools.includes('.dashbridge-panel-capture-toggle-active { color:#5794f2 !important; background:transparent !important; box-shadow:none !important; }'),
    'native Grafana compact capture must use a blue icon without a persistent button background');
assert(dashboardCapture.includes('captureSnapshot?.forEach'), 'DashBridge capture must restore the card layout');
assert(dashboard.includes('dashbridgeCapturePreparedChanged'), 'DashBridge must persist the toolbar toggle in the panel profile');
assert(!dashboard.includes("card.querySelector('.btn-capture-toggle')")
    && dashboardHtml.includes('id="capturePreparedToggleBtn"')
    && dashboard.includes("card.querySelector('.btn-capture-save')")
    && dashboard.includes("card.querySelector('.btn-capture-copy')"),
    'DashBridge cards must keep save/copy actions while compact mode has one header control');
assert(dashboard.includes("runToolbarCapture(panel, iframe, 'download'")
    && dashboard.includes("runToolbarCapture(panel, iframe, 'copy'"),
    'DashBridge toolbar must reuse the existing panel capture pipeline');
assert(dashboard.includes('setCapturePrepared(!getCapturePrepared())'), 'DashBridge toolbar toggle must update the shared prepared-capture setting');
assert(dashboardCapture.includes("'box-sizing', 'border'"), 'DashBridge capture must snapshot its temporary border override');
assert(dashboardCapture.includes("setProperty('border', 'none', 'important')"), 'the card border must not distort the prepared iframe aspect ratio');
assert(dashboardCss.includes('.panel-card.dashbridge-panel-capture-active .panel-actions')
    && dashboardCss.includes('visibility: hidden !important;')
    && dashboardCss.includes('transition: none !important;'),
    'DashBridge capture must hide its toolbar immediately instead of capturing an opacity transition');
assert(tools.includes('panelCaptureInProgress') && dashboardCapture.includes('panelCaptureInProgress'), 'both hosts must reject overlapping captures');

console.log('PASS Grafana panel capture preserves aspect ratio and restores both hosts');
