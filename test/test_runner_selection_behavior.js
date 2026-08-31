const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const suiteSource = fs.readFileSync(path.join(root, 'pages/test-runner/test-runner-suite.js'), 'utf8');
const coreSource = fs.readFileSync(path.join(root, 'pages/test-runner/test-runner-core.js'), 'utf8');
const uiSource = fs.readFileSync(path.join(root, 'pages/test-runner/test-runner-ui.js'), 'utf8');
const selectorSource = fs.readFileSync(path.join(root, 'pages/test-runner/test-selector.js'), 'utf8');
const selectorHtml = fs.readFileSync(path.join(root, 'pages/test-runner/test-selector.html'), 'utf8');

const context = vm.createContext({ console, URL, URLSearchParams, setTimeout, clearTimeout });
vm.runInContext(`${suiteSource}\nthis.__suite = DASHBRIDGE_TEST_SUITE; this.__thresholdOff = matrixInvariants.thresholdOff;`, context);
const suite = context.__suite;
const thresholdOff = context.__thresholdOff;

assert(suite.length >= 60, 'the human catalog must cover the complete generated suite as it grows');
assert(suite.every(test => typeof test.name === 'string' && test.name.length > 3), 'every test needs a human name');
assert(suite.every(test => typeof test.description === 'string' && test.description.length > 15), 'every test needs a human description');
assert(suite.filter(test => test.category === 'H').every(test => Array.isArray(test.steps) && test.steps.length > 0),
    'every generated lifecycle scenario needs visible user steps');
assert.strictEqual(suite.find(test => test.id === 'H1_1').name, 'Заливка графика: включение');
assert.match(suite.find(test => test.id === 'HP9_1').name, /Фильтр отображаемых серий.*Порог на графике/);
assert.match(suite.find(test => test.id === 'HR3').description, /финальный reset/);

const cleanThresholdBaseline = { dom: { thresholdApplied: false }, diagnostic: { tools: { thresholdEnabled: false } } };
const cleanThresholdCurrent = { dom: { thresholdApplied: false }, diagnostic: { tools: { thresholdEnabled: false }, thresholdDiagnostic: null } };
assert.strictEqual(thresholdOff(cleanThresholdBaseline, cleanThresholdCurrent).pass, true,
    'an independently selected non-threshold scenario must accept a threshold that stayed inactive');
const previouslyActiveThreshold = { dom: { thresholdApplied: true }, diagnostic: { tools: { thresholdEnabled: true } } };
assert.strictEqual(thresholdOff(previouslyActiveThreshold, cleanThresholdCurrent).pass, false,
    'a scenario that had an active threshold must still require explicit removal evidence');
const explicitThresholdRemoval = { dom: { thresholdApplied: false }, diagnostic: { tools: { thresholdEnabled: false }, thresholdDiagnostic: { enabled: false, status: { enabled: false } } } };
assert.strictEqual(thresholdOff(previouslyActiveThreshold, explicitThresholdRemoval).pass, true,
    'explicit threshold removal evidence must satisfy the reset invariant');

assert(coreSource.includes('selectedTestIds = null')
    && coreSource.includes('const selectionMatch = !selectedIds || selectedIds.has(t.id);')
    && coreSource.includes("selection: selectedIds ? { scope: 'selected', ids: [...selectedIds] }"),
    'core must apply an explicit stable-ID selection after profile and URL filters');
assert(uiSource.includes('function persistCompactTestHistory(snapshot)')
    && uiSource.includes("runs: [run, ...(previous.runs || []).filter(item => item.runId !== run.runId)].slice(0, 20)")
    && uiSource.includes('selectedTestIds,'),
    'the runner must persist bounded compact history and pass the selected IDs');
assert(!selectorSource.includes('innerHTML') && selectorSource.includes('document.createElement'),
    'selector must render external test metadata through DOM properties, not HTML strings');
assert(selectorSource.includes("preset === 'failed'")
    && selectorSource.includes("preset === 'not-run'")
    && selectorSource.includes("trTestSelection"),
    'selector must support last-failure and NOT RUN presets and persist its choice');
assert(selectorHtml.includes('data-preset="failed"')
    && selectorHtml.includes('data-preset="not-run"')
    && selectorSource.includes('Что делает тест'),
    'selector UI must expose failure presets and understandable scenario details');

console.log('PASS test runner selection, history and human scenario catalog');
