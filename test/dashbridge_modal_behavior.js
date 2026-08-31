'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

class FakeElement {
    constructor(tagName) {
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.style = {};
        this.listeners = {};
        this.parentNode = null;
        this.className = '';
        this.textContent = '';
        this.value = '';
        this.focused = false;
        this.selected = false;
    }

    appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
    }

    addEventListener(type, listener) {
        (this.listeners[type] ||= []).push(listener);
    }

    dispatch(type, extra = {}) {
        const event = { target: this, ...extra };
        for (const listener of this.listeners[type] || []) listener(event);
    }

    remove() {
        if (!this.parentNode) return;
        this.parentNode.children = this.parentNode.children.filter(child => child !== this);
        this.parentNode = null;
    }

    focus() { this.focused = true; }
    select() { this.selected = true; }

    querySelector(selector) {
        const className = selector.startsWith('.') ? selector.slice(1) : null;
        if (className && this.className.split(/\s+/).includes(className)) return this;
        for (const child of this.children) {
            const match = child.querySelector(selector);
            if (match) return match;
        }
        return null;
    }
}

const body = new FakeElement('body');
const window = {};
const context = {
    window,
    document: {
        body,
        createElement: tagName => new FakeElement(tagName),
    },
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('pages/dashbridge/dashbridge-modal.js', 'utf8'), context);
const modal = window.DashBridgeModal;

(async () => {
    assert(Object.isFrozen(modal), 'modal API must be immutable');

    const alertResult = modal.showAlert('<img src=x onerror=alert(1)>');
    let overlay = body.children.at(-1);
    assert.strictEqual(overlay.querySelector('p'), null, 'test DOM supports class lookup only');
    const alertText = overlay.children[0].children[0].children[0];
    assert.strictEqual(alertText.textContent, '<img src=x onerror=alert(1)>', 'external text must not become markup');
    const alertOk = overlay.querySelector('.modal-ok');
    assert.strictEqual(alertOk.focused, true);
    alertOk.dispatch('click');
    assert.strictEqual(await alertResult, true);
    assert.strictEqual(body.children.length, 0);

    const confirmResult = modal.showConfirm('Удалить?\nТочно?');
    overlay = body.children.at(-1);
    assert.strictEqual(overlay.children[0].children[0].children[0].style.whiteSpace, 'pre-line');
    overlay.dispatch('click');
    assert.strictEqual(await confirmResult, false, 'backdrop must cancel confirmation');

    const promptResult = modal.showPrompt('Название', 'A&B"');
    overlay = body.children.at(-1);
    const input = overlay.querySelector('.modal-input');
    assert.strictEqual(input.value, 'A&B"', 'default value must be assigned as a DOM property');
    assert.strictEqual(input.focused, true);
    assert.strictEqual(input.selected, true);
    input.value = 'Новый профиль';
    input.dispatch('keydown', { key: 'Enter' });
    assert.strictEqual(await promptResult, 'Новый профиль');

    const cancelledPrompt = modal.showPrompt('Название');
    overlay = body.children.at(-1);
    overlay.querySelector('.modal-input').dispatch('keydown', { key: 'Escape' });
    assert.strictEqual(await cancelledPrompt, null);
    assert.strictEqual(body.children.length, 0);

    const html = fs.readFileSync('pages/dashbridge/dashbridge.html', 'utf8');
    assert(html.indexOf('dashbridge-modal.js') < html.indexOf('dashbridge.js'),
        'modal owner must load before the DashBridge controller');
    const controller = fs.readFileSync('pages/dashbridge/dashbridge.js', 'utf8');
    assert(controller.includes('const { showAlert, showConfirm, showPrompt } = window.DashBridgeModal;'));
    assert(!controller.includes('function showAlert(') && !controller.includes('function showConfirm(')
        && !controller.includes('function showPrompt('), 'controller must not retain duplicate modal owners');

    console.log('PASS DashBridge modal module preserves alert, confirm and prompt contracts');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
