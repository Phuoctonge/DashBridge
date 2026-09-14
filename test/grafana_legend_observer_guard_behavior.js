'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'content', 'grafana-legend-visuals.js'), 'utf8');
assert(source.includes("attributeFilter: window.name === 'dashbridge-iframe'"),
    'legacy legend observer must have an iframe-specific attribute set');
assert(source.includes("? ['width', 'height', 'class', 'd']"),
    'DashBridge legend observer must not observe style mutations created by its own painter');
assert(source.includes('const stopLegendColumnsObserver = target => {')
    && source.includes('target.__dashBridgeLegendColumnsObserver?.disconnect?.()')
    && source.includes('target.__dashBridgeLegendColumnsObserverFrame?.()'),
    'legend column observer and pending refresh must have an explicit cleanup contract');
assert(source.includes('if (requested.last !== true) stopLegendColumnsObserver(root);'),
    'disabling Last must stop its DOM observer instead of scanning future Grafana refreshes');
const stopStart = source.indexOf('const stopLegacyVisualObservers = root => {');
const stopEnd = source.indexOf('\n        };', stopStart);
assert(source.slice(stopStart, stopEnd).includes('stopLegendColumnsObserver(node);'),
    'visual reset must release the legend column observer before applying refreshed state');
console.log('PASS DashBridge legacy legend observer avoids self-triggered style loop');
