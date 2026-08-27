const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'content', 'grafana-visual-engine.js'), 'utf8');

assert(source.includes('const stopThresholdLayoutChanges = chartHost =>')
    && source.includes('controller.observer?.disconnect();')
    && source.includes('controller.resizeObserver?.disconnect();')
    && source.includes('controller.cancelScheduledFrames?.();')
    && source.includes('delete chartHost.__dashbridgeThresholdLayoutObserver;'),
    'disabling a Flot threshold must release only its layout observers and queued frames');

assert(source.includes('if (!enabled || !Number.isFinite(Number(value))) {\n            stopThresholdLayoutChangesInRoot(root);')
    && source.includes('watchThresholdDataChanges(plot);')
    && !source.includes('delete chart.__dashbridgeThresholdDataHooked'),
    'threshold cleanup must not restore the shared setData hook used by filter highlights');

console.log('PASS disabling a Flot threshold releases its layout-only observers');
