"""Contracts for per-panel Grafana transformations in Batch collection."""
from pathlib import Path
from support.smoke import CheckCollector


ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / 'html/batch.html').read_text(encoding='utf-8')
JS = (ROOT / 'js/pages/batch.js').read_text(encoding='utf-8')
LOADER = (ROOT / 'js/pages/batch-panel-loader.js').read_text(encoding='utf-8')


check = CheckCollector()


check('Batch loads the shared panel-rules storage module', 'js/shared/grafana-batch-panel-rules.js' in HTML)
check('Batch exposes the panel-rules editor', 'id="batchPanelRules"' in HTML and 'id="addBatchPanelRuleBtn"' in HTML)
check('Batch uses automatic rule persistence', 'id="resetBatchPanelRulesBtn"' in HTML and 'scheduleBatchPanelRulesSave' in JS)
check('Batch no longer exposes large save and clear actions', 'id="saveBatchPanelRulesBtn"' not in HTML and 'id="clearBatchPanelRulesBtn"' not in HTML)
check('Batch reloads rules when the dashboard URL changes', 'loadBatchPanelRules' in JS and "dashUrl.addEventListener('change'" in JS)
check('Batch persists rules after editor changes', 'scheduleBatchPanelRulesSave' in JS and 'addEventListener' in JS)
check('Delayed rule saving keeps the URL that was edited', 'const saveUrl = dashUrl.value.trim();' in JS)
check('Changing dashboard cancels an old delayed rules save', "dashUrl.addEventListener('change', () => { clearTimeout(batchPanelRulesSaveTimer);" in JS)
check('Rules reset is hidden when no saved rules exist', '#resetBatchPanelRulesBtn[hidden]' in (ROOT / 'css/batch.css').read_text(encoding='utf-8'))
check('Batch rule labels match the Grafana panel settings',
      'Убрать заливку графика' in JS
      and 'Утолщить линии графика' in JS
      and 'Переместить легенду: справа ↔ снизу' in JS
      and 'Инвертировать CPU-график: Idle → Load' in JS
      and 'Конвертировать RAM-график в % Used' in JS
      and 'Толщина ' in JS)
check('Thickness value is enabled only with its checkbox', 'width.hidden = !enabled' in JS and 'widthInput.disabled = !enabled' in JS)
check('Main capture resolves a rule by panel ID', 'BatchPanelRules.forPanel(mainPanelRules, pid)' in JS)
check('Series capture resolves a rule by panel ID', 'BatchPanelRules.forPanel(seriesPanelRules, pid)' in JS)
check('Loader applies tools before waiting for the capture rectangle', 'await applySharedGrafanaPanelTools' in LOADER and LOADER.index('await applySharedGrafanaPanelTools') < LOADER.rindex('waitForPanelInMainWorld'))
check.finish()
