'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('js/shared/grafana-capture-output.js', 'utf8');

function fixture() {
    let sequence = 0;
    const frames = new Map();
    const timers = new Map();
    const listeners = new Map();
    const context = {
        AbortController, console,
        document: { visibilityState: 'visible' },
        requestAnimationFrame(callback) { frames.set(++sequence, callback); return sequence; },
        cancelAnimationFrame(id) { frames.delete(id); },
        setTimeout(callback) { timers.set(++sequence, callback); return sequence; },
        clearTimeout(id) { timers.delete(id); },
        addEventListener(type, callback) { listeners.set(type, callback); },
        removeEventListener(type, callback) { if (listeners.get(type) === callback) listeners.delete(type); },
    };
    const canvas = { width: 800, height: 300, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 300 }) };
    const element = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 520 }),
        querySelectorAll: () => [canvas] };
    vm.runInNewContext(source, context);
    return {
        context, canvas, element, frames, timers, listeners,
        wait: options => context.DashBridgeGrafanaCaptureOutput.waitForStableLayout(element, options),
        frame() { const queued = [...frames.values()]; frames.clear(); queued.forEach(callback => callback()); },
        deadline() { [...timers.values()].forEach(callback => callback()); },
        clean() { assert.equal(frames.size, 0); assert.equal(timers.size, 0); assert.equal(listeners.size, 0); },
    };
}

(async () => {
    const stable = fixture();
    const result = stable.wait();
    // Renderer keeps resizing well beyond the former fixed 250ms window.
    for (let index = 0; index < 20; index++) { stable.canvas.width++; stable.frame(); }
    assert.equal(stable.frames.size, 1, 'capture must keep waiting while canvas dimensions change');
    for (let index = 0; index < 4; index++) stable.frame();
    assert.equal((await result).status, 'stable');
    stable.clean();

    const remount = fixture();
    const remountResult = remount.wait();
    remount.frame(); remount.frame();
    remount.element.querySelectorAll = () => [{ ...remount.canvas }];
    for (let index = 0; index < 5; index++) remount.frame();
    assert.equal(remount.frames.size, 1, 'same-size renderer replacement must reset stability');
    remount.element.querySelectorAll = () => [remount.canvas];
    for (let index = 0; index < 5; index++) remount.frame();
    assert.equal((await remountResult).status, 'stable');
    remount.clean();

    const deadline = fixture();
    const deadlineResult = deadline.wait();
    deadline.deadline();
    assert.equal((await deadlineResult).status, 'deadline', 'missing animation frames must softly release capture');
    deadline.clean();

    const abort = fixture();
    const controller = new AbortController();
    const abortResult = abort.wait({ signal: controller.signal });
    controller.abort();
    await assert.rejects(abortResult, /capture-cancelled/);
    abort.clean();

    const hidden = fixture();
    const hiddenResult = hidden.wait();
    hidden.context.document.visibilityState = 'hidden';
    hidden.listeners.get('visibilitychange')();
    assert.equal((await hiddenResult).status, 'hidden');
    hidden.clean();

    const stopped = fixture();
    const stoppedResult = stopped.wait();
    stopped.listeners.get('pagehide')();
    await assert.rejects(stoppedResult, /capture-cancelled/);
    stopped.clean();

    const unavailable = fixture();
    unavailable.element.getBoundingClientRect = () => { throw new Error('renderer-unavailable'); };
    const unavailableResult = unavailable.wait();
    unavailable.frame();
    assert.equal((await unavailableResult).status, 'unavailable');
    unavailable.clean();
    console.log('PASS adaptive capture readiness: stable, resizing, remount, deadline, hidden, abort and cleanup');
})().catch(error => { console.error(error); process.exitCode = 1; });
