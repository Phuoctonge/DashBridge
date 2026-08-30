"""Regression contracts for the Batch fixes identified in the audit."""
from pathlib import Path
from support.smoke import CheckCollector


ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / 'batch.html').read_text(encoding='utf-8')
JS = (ROOT / 'js/pages/batch.js').read_text(encoding='utf-8')
CAPTURE_UTILS = (ROOT / 'js/pages/batch-capture-utils.js').read_text(encoding='utf-8')
CSS = (ROOT / 'css/batch.css').read_text(encoding='utf-8')
PANEL_LOADER = (ROOT / 'js/pages/batch-panel-loader.js').read_text(encoding='utf-8')


check = CheckCollector()


check('Series loader status element exists', 'id="seriesLoaderStatus"' in HTML)
check('Series processing disables its own start button', 'startSeriesBtn.disabled = active' in JS)
check('Series cancellation remains visible while Series runs', 'cancelBtn.hidden = !active' in JS and 'mainActionArea.hidden' not in JS.split('function setProcessing', 1)[1].split('}', 1)[0])
check('Authorization recovery has a finite timeout', 'AUTH_RECOVERY_TIMEOUT_MS' in JS and 'setTimeout' in JS)
check('Standalone Series filenames include a stable occurrence suffix', 'seriesIndex' in JS and 'occurrence' in JS)
check('Batch filenames are unique and Confluence-safe', 'buildCaptureFilename' in CAPTURE_UTILS
      and 'BatchCaptureUtils.createFilenameFactory' in JS and '`[${pid}]_' not in JS
      and r'\[\]' in CAPTURE_UTILS)
check('Multiple time ranges use separate ZIP folders', 'buildArchivePath' in CAPTURE_UTILS
      and 'rangeCount: timestamps.length' in JS and 'rangeIndex' in JS)
check('Batch status uses shared theme tokens', 'var(--status-success-bg)' in CSS and 'var(--status-danger-bg)' in CSS)
check('Batch has narrow-screen layout rules', '@media' in CSS)
check('Batch exposes visible keyboard focus', ':focus-visible' in CSS)
check('Batch capture blocks physical pointer hover and tooltip portals',
      'dashbridge-batch-pointer-shield' in PANEL_LOADER
      and 'pointer-events:auto' in PANEL_LOADER
      and '[role="tooltip"]' in PANEL_LOADER
      and '.u-cursor-x' in PANEL_LOADER
      and "new MouseEvent('mouseleave'" in PANEL_LOADER)
check('Batch uses the shared gradient page header',
      'class="batch-header"' in HTML and 'background: var(--header-grad)' in CSS)
check('Batch panel picker buttons match adjacent URL field height',
      '.batch-url-actions .btn { height: 100%;' in CSS
      and '.batch-url-actions .btn { height: 100%; min-height: var(--control-height-lg); margin-top: 0; }' in CSS
      and 'align-items: stretch' in CSS)
check('Batch compact capture choices use accessible switches',
      HTML.count('class="batch-switch-slider"') == 2
      and 'id="compactCaptureMain"' in HTML
      and 'id="compactCaptureSeries"' in HTML
      and '.batch-switch input:checked + .batch-switch-slider' in CSS)
check('Main action uses the shared primary button variant', 'id="startBtn" class="btn btn-primary"' in HTML)
check('Cancel action uses the shared danger button variant', 'id="cancelBtn" class="btn btn-danger"' in HTML)
check('Batch action buttons are compact instead of globally full-width', '#mainActionArea .btn' in CSS and 'width: 100%;' not in CSS.split('.btn {', 1)[1].split('}', 1)[0])
check('Panel navigation is awaited before readiness polling', 'await chrome.tabs.update(tabId, { url: target.toString() })' in (ROOT / 'js/pages/batch-panel-loader.js').read_text(encoding='utf-8'))
check('Batch state writes are debounced', 'saveTimer' in (ROOT / 'js/pages/batch-state.js').read_text(encoding='utf-8') and 'setTimeout' in (ROOT / 'js/pages/batch-state.js').read_text(encoding='utf-8'))
check('Batch exposes progress counters', 'batchProgress' in HTML and 'updateBatchProgress' in JS)
check('Rule loading ignores stale URL responses', 'batchPanelRulesLoadVersion' in JS)
check('Cancel button is explicitly hidden outside an active run', '#cancelBtn[hidden]' in CSS and 'setProcessing(false)' in JS)
check('Grafana base paths are preserved for dashboard API calls', 'basePath' in (ROOT / 'js/shared/grafana-url.js').read_text(encoding='utf-8'))
check('Exact Batch capture cannot fall back to a different panel', 'targetPanelId === null' in (ROOT / 'js/shared/grafana-panel-capture.js').read_text(encoding='utf-8'))
check('Batch waits for aggregated Series responses to settle',
      'const settleWait = Math.max(0, 400 - (Date.now() - capture.lastMatchAt))' in JS
      and "window.addEventListener('dashbridgeSeriesCaptureUpdated', onUpdate)" in JS
      and 'state.batches' in (ROOT / 'js/content/grafana-series-capture.js').read_text(encoding='utf-8'))
check('Batch filters actual Series names by include and ignore patterns',
      'BatchSeriesSelection.resolvePatterns(discovery.names, includePattern, ignorePattern)' in JS
      and 'id="seriesIncludeFilter"' in HTML and 'id="seriesIgnoreFilter"' in HTML)
check('Batch writes a result manifest and handles an empty collection', 'manifest.json' in JS and 'if (!successfulJobs)' in JS)
check('Panel loader receives the active cancellation signal', 'BatchRunLifecycle.signal(runId)' in JS and "signal?.addEventListener('abort'" in (ROOT / 'js/pages/batch-panel-loader.js').read_text(encoding='utf-8'))
check('Batch exposes an always-on-top cancellable PiP panel',
      'js/pages/operation-progress-window.js' in HTML
      and 'openPictureInPicture' in JS
      and 'cancelActiveBatchRun' in JS)
check('Removed popup progress window is not used as a fallback',
      not (ROOT / 'operation-progress.html').exists()
      and 'operationProgressController.focus()' not in JS)
check.finish()
