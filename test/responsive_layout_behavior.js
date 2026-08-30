'use strict';

const assert = require('assert');
const fs = require('fs');

const read = path => fs.readFileSync(path, 'utf8');
const themeCss = read('css/theme.css');
const themeJs = read('js/theme.js');
const dashboardCss = read('css/dashbridge.css');
const dashboardJs = read('js/pages/dashbridge.js');
const renderer = read('js/pages/dashbridge-renderer.js');
const optionsHtml = read('pages/options/options.html');
const optionsJs = read('pages/options/options.js');

for (const token of ['--page-gutter:', '--control-height-md:', '--readable-max:']) {
    assert(themeCss.includes(token), `shared responsive token ${token} is missing`);
}
for (const scale of ['auto', '90', '100', '110', '125', '150']) {
    assert(themeCss.includes(`data-ui-scale="${scale}"`), `CSS scale ${scale} is missing`);
}
assert(themeJs.includes("const UI_SCALE_SYNC_KEY = 'uiScale'")
    && themeJs.includes("document.documentElement.setAttribute('data-ui-scale', scale)"),
    'the shared runtime must apply and synchronize interface scale');
assert(optionsHtml.includes('id="settingUiScale"')
    && optionsJs.includes('uiScale: document.getElementById("settingUiScale").value'),
    'Options must expose and save the shared scale');

for (const page of ['html/batch.html', 'html/dashbridge.html', 'pages/options/options.html', 'html/popup.html', 'pages/recorder/recorder.html', 'html/test-runner.html', 'pages/worklog/worklog.html']) {
    assert(read(page).includes('name="viewport"'), `${page} must declare its viewport`);
}
for (const page of ['html/batch.html', 'html/dashbridge.html', 'pages/options/options.html', 'pages/recorder/recorder.html', 'html/test-runner.html', 'pages/worklog/worklog.html', 'pages/debug-easter-egg/debug-easter-egg.html']) {
    assert(read(page).includes('data-ui-scale="auto"'), `${page} must scale correctly from its first frame`);
}

assert(dashboardCss.includes('grid-template-columns: repeat(12, minmax(0, 1fr))')
    && dashboardCss.includes('container: dashboard / inline-size')
    && dashboardCss.includes('@container dashboard'),
    'DashBridge must use a container-responsive grid');
assert(!dashboardCss.includes('max-width: 1800px'), 'DashBridge must not retain its Full HD workspace ceiling');
assert(renderer.includes("card.dataset.panelSize = panel.width === '100%'"),
    'stored legacy widths must map to semantic grid sizes');
assert(renderer.includes("card.dataset.heightMode = panel.height === '350px' ? 'auto' : 'fixed'"),
    'legacy default height must become responsive while custom heights stay fixed');
assert(!renderer.includes('card.style.width = width'), 'panel width must no longer be frozen inline');
assert(dashboardJs.includes("card.dataset.panelSize = panel.width === '100%'"),
    'editing a panel must refresh its semantic grid size');

assert(read('css/batch.css').includes('max-width: 80rem'), 'Batch must use the wider responsive workspace');
const testRunnerCss = read('css/test-runner.css');
assert(testRunnerCss.includes('.tr-layout') && testRunnerCss.includes('max-width: none')
    && testRunnerCss.includes('.tr-input-panel') && testRunnerCss.includes('width: 100%')
    && testRunnerCss.includes('#trRunMode') && testRunnerCss.includes('width: auto')
    && testRunnerCss.includes('min-width: 57.5rem') && testRunnerCss.includes('.tr-results-wrap { overflow: auto; }'),
    'Test Runner controls and results must use wide screens while the table keeps a local scroller');
assert(read('pages/worklog/worklog.css').includes('min-width: 68rem')
    && read('pages/worklog/worklog.css').includes('overflow: auto'),
    'Worklog must keep usable columns inside a local horizontal scroller');
assert(read('pages/recorder/recorder.css').includes('@media (max-width: 820px)')
    && read('pages/recorder/recorder.css').includes('.table-wrap { flex: 1 1 auto;')
    && read('pages/recorder/recorder.css').includes('overflow: auto;'),
    'Recorder must collapse its workspace while preserving a local table scroller');
assert(read('pages/options/options.css').includes('@media (max-width: 560px)')
    && read('pages/options/options.css').includes('max-width: 40.625rem'),
    'Options must retain a readable form width and collapse on narrow screens');

const debugCss = read('pages/debug-easter-egg/debug-easter-egg.css');
const debugController = read('js/popup/popup-debug-easter-egg.js');
const debugWindow = read('pages/debug-easter-egg/debug-easter-egg.js');
assert(debugCss.includes('width: 40rem') && debugCss.includes('max-width: calc(100vw - 2rem)')
    && debugController.includes('interfaceScale') && debugController.includes('?uiScale=')
    && debugWindow.includes('document.documentElement.dataset.uiScale = requestedScale'),
    'the external debug window must inherit scale and remain bounded by its viewport');

const progressCss = read('css/operation-progress.css');
const progressController = read('js/pages/operation-progress-window.js');
assert(progressCss.includes('min-width: 21.25rem') && progressCss.includes('font-size: 0.875rem')
    && progressController.includes('dataset.uiScale') && progressController.includes('interfaceScale'),
    'the Picture-in-Picture progress window must inherit and size itself to the interface scale');

const panelSettings = read('js/shared/grafana-panel-settings-modal.js');
assert(panelSettings.includes('const getInterfaceScale = () =>')
    && panelSettings.includes("root?.dataset?.uiScale === 'auto'")
    && panelSettings.includes('overlay.style.fontSize = `${13 * getInterfaceScale()}px`')
    && panelSettings.includes("Native Grafana already follows browser zoom")
    && panelSettings.includes('max-height:calc(100dvh - 2.4616em)')
    && panelSettings.includes('@media (max-width:480px)'),
    'floating graph settings, threshold fields and Load Average controls must scale independently of their host and stay viewport-bound');

const dashbridgeCss = read('css/dashbridge.css');
const grafanaPanelTools = read('js/content/grafana-panel-tools.js');
const grafanaContent = read('js/content/content.js');
assert(dashbridgeCss.includes('width: min(45rem, calc(100vw - 2.5rem))')
    && dashbridgeCss.includes('max-height: calc(100dvh - 2.5rem)')
    && dashbridgeCss.includes('width: min(22.5rem, calc(100vw - 2.25rem))')
    && dashbridgeCss.includes('max-width: 56.25rem')
    && dashbridgeCss.includes('max-height: 92dvh'),
    'hidden DashBridge pickers, notifications and report editors must use scalable geometry and dynamic viewport bounds');
assert(grafanaPanelTools.includes('max-height:calc(100dvh - 40px)')
    && grafanaPanelTools.includes('width:min(360px,calc(100vw - 36px))')
    && grafanaContent.includes('max-height:calc(100dvh - 40px)')
    && grafanaContent.includes('overflow:auto')
    && grafanaContent.includes('@media(max-width:480px)'),
    'DashBridge overlays injected into native Grafana must remain viewport-bound without rescaling Grafana itself');

console.log('PASS extension pages use shared scaling and responsive workspaces');
