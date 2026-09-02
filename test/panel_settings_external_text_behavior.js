const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'shared', 'grafana-panel-settings-modal.js'), 'utf8');
const context = { window: {} };
vm.createContext(context);
vm.runInContext(source, context);

const modal = context.window.DashBridgePanelSettingsModal;
const hostileUnit = 'GiB</span><input name="thresholdValue" value="999">';
const thresholdHtml = modal.thresholdFields({ thresholdEnabled: true, thresholdValue: 10, thresholdUnit: hostileUnit });
const disabledThresholdHtml = modal.thresholdFields({ thresholdEnabled: false, thresholdNotifyEnabled: true });
const transformHtml = modal.transformFields({ thresholdUnit: hostileUnit }, { panelKind: 'load' });
const cpuTransformHtml = modal.transformFields({}, { panelKind: 'cpu' });
const visualHtml = modal.visualFields({ removeFill: true, thickenLines: false, invertLegend: false });

assert(!thresholdHtml.includes('</span><input name="thresholdValue" value="999">'));
assert(!transformHtml.includes('</span><input name="thresholdValue" value="999">'));
assert(thresholdHtml.includes('GiB&lt;/span&gt;&lt;input'));
assert(thresholdHtml.includes('panel-alert-threshold'));
assert(thresholdHtml.includes('data-unit-control="thresholdInputUnit"')
    && transformHtml.includes('data-unit-control="seriesQueryFilterInputUnit"')
    && thresholdHtml.includes('role="radiogroup"'),
    'threshold and displayed-series filter expose independent unit radio groups');
assert(thresholdHtml.includes('Порог на графике') && thresholdHtml.includes('Уведомлять о превышении'),
    'threshold rendering must present the threshold and notifications as separate controls');
assert(thresholdHtml.includes('panel-alert-threshold-config') && !thresholdHtml.includes('panel-alert-notify-hint'),
    'threshold rendering must keep notifications inside the threshold details without a redundant disabled hint');
assert(disabledThresholdHtml.includes('class="panel-alert-threshold-details" hidden'),
    'threshold details and notifications must be hidden while the threshold is off');
assert(source.includes('notifyInput.disabled = !thresholdEnabled'),
    'notifications must be unavailable while their required threshold is disabled');
assert(source.includes('alertDetails.hidden = !thresholdEnabled'),
    'threshold details must follow the parent switch without resetting the saved notification preference');
assert(transformHtml.includes('panel-tools-transform'));
assert(transformHtml.includes('class="panel-tools-series-filter-prompt">Показывать только серии со значением больше:</span>'),
    'the displayed-series prompt must end with a colon and own a full row above its value controls');
assert(transformHtml.includes('name="cpuCapacityFilterEnabled"')
    && transformHtml.includes('name="cpuCapacityFilterCoefficient"')
    && transformHtml.includes('name="seriesQueryFilterHighlightEnabled" checked')
    && transformHtml.includes('name="cpuCapacityFilterHighlightEnabled" checked')
    && transformHtml.includes('Утолщать участки превышения')
    && transformHtml.includes('Если количество CPU не определено')
    && transformHtml.includes('Участки выше порога утолщаются')
    && transformHtml.includes('остаётся одна с наибольшим значением в выбранном режиме'),
    'settings expose a separate dynamic vCPU filter with fail-open guidance');
const disabledHighlightHtml = modal.transformFields({
    seriesQueryFilterHighlightEnabled: false,
    cpuCapacityFilterHighlightEnabled: false
}, { panelKind: 'load' });
assert(!disabledHighlightHtml.includes('name="seriesQueryFilterHighlightEnabled" checked')
    && !disabledHighlightHtml.includes('name="cpuCapacityFilterHighlightEnabled" checked'),
    'each filter owns an independent persisted highlight switch');
assert(transformHtml.includes('name="cpuCapacityFilterLoad1" checked')
    && transformHtml.includes('name="cpuCapacityFilterLoad5" ')
    && transformHtml.includes('name="cpuCapacityFilterLoad15" '),
    'Load 1m is the only selected series type by default');
assert(transformHtml.includes('Load 1m') && transformHtml.includes('Load 5m') && transformHtml.includes('Load 15m')
    && !transformHtml.includes('Быстро показывает текущие всплески.'),
    'Load Average windows use compact names and omit the removed 1m hint');
assert(visualHtml.includes('data-toggle-hint="removeFill"')
    && cpuTransformHtml.includes('data-toggle-hint="invertIdle"')
    && source.includes('const updateSimpleToggleHints = () =>'),
    'simple panel toggles show concise explanations only while enabled');

const legendHtml = modal.legendFields('fast_click_toggle', { legendSelectFilter: 'cpu', legendIgnoreFilter: 'idle' });
assert(!legendHtml.includes('Режим отображения') && !legendHtml.includes('Выключение неактивных серий')
    && !legendHtml.includes('name="legendMode"'),
    'the removed click-toggle mode must not remain user-selectable');
assert(legendHtml.includes('Быстрый выбор') && legendHtml.includes('Серии на графике')
    && legendHtml.includes('Показать все'),
    'legend settings must expose only pattern selection, reset, and rendered series');
assert(legendHtml.includes('panel-tools-pattern-field') && legendHtml.includes('panel-tools-legend-section'),
    'legend input and display areas must use dedicated layout containers');
assert(source.includes("const legendMode = 'fast_complete_hide';")
    && source.includes('legendResetRequested = true')
    && source.includes('legendSelectionVersion: keepAllowlist ?'),
    'complete-hide must be the sole saved mode and reset must disable its allowlist');
assert(source.includes("['thickenLinesValue', 1.5]")
    && source.includes('updateThicknessControls(); updateSeriesFilterUnits();'),
    'Reset All must restore the line-width draft and every derived control');
assert(!source.includes('state.thresholdRawValue = null')
    && !source.includes('state.seriesQueryFilterRawValue = null')
    && source.includes('thresholdUnitControl.reset(); seriesFilterUnitControl.reset();'),
    'Reset All must not mutate persisted panel state before Save');
assert(source.includes('const setLegendLoading = loading =>')
    && source.includes('selectFilter.disabled = loading')
    && source.includes('ignoreFilter.disabled = loading')
    && source.includes('refreshLegendButton.disabled = loading')
    && source.includes('finally {\n                setLegendLoading(false);'),
    'legend pattern controls must stay disabled until asynchronous series loading settles');
assert(source.includes('renderLegend(Array.isArray(series) ? series : [])')
    && source.includes('Не удалось загрузить серии. Повторите попытку.'),
    'unexpected legend responses must fail locally without changing the saved selection');
assert.strictEqual(modal.normalizeExternalText('  req/s\u0000\n  '), 'req/s');

const minuteOptions = modal.resolveUnitOptions({ unit: 'mins', factor: 60_000 }, 's');
assert.strictEqual(minuteOptions.selectedUnit, 's');
assert.deepStrictEqual(Array.from(minuteOptions.options, option => option.unit), ['ms', 's', 'min'],
    'a millisecond duration graph must expose the three useful input units shown by Grafana');
assert.strictEqual(minuteOptions.options.find(option => option.unit === 's').factor, 1000);
assert.strictEqual(minuteOptions.options.find(option => option.unit === 'ms').factor, 1);
assert.strictEqual(2 * minuteOptions.options.find(option => option.unit === 's').factor, 2000,
    'two seconds must be stored as the same raw threshold used by Grafana');
assert.strictEqual(modal.resolveUnitOptions({ unit: 'mins', factor: 60_000 }).selectedUnit, 's',
    'a new duration setting must select the middle useful unit');
const secondsOptions = modal.resolveUnitOptions({ unit: 's', factor: 1 }, 'min');
assert.strictEqual(secondsOptions.options.find(option => option.unit === 'min').factor, 60,
    'unit conversion must also work when Grafana raw values are seconds rather than milliseconds');
const byteRateOptions = modal.resolveUnitOptions({ unit: 'MiB/s', factor: 1024 ** 2 }, 'GiB/s');
assert.deepStrictEqual(Array.from(byteRateOptions.options, option => option.unit), ['KiB/s', 'MiB/s', 'GiB/s'],
    'byte and byte-rate settings must remain bounded to three adjacent units');
assert.strictEqual(byteRateOptions.options.find(option => option.unit === 'GiB/s').factor, 1024 ** 3);
const unknownOptions = modal.resolveUnitOptions({ unit: 'req/s', factor: 1 }, 's');
assert.strictEqual(unknownOptions.scalable, false, 'unknown unit families must remain fixed instead of guessing');

console.log('PASS external Grafana metadata is rendered as text, not modal markup');
