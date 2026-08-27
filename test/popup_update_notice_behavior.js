'use strict';

const assert = require('assert');
const fs = require('fs');

const html = fs.readFileSync('popup.html', 'utf8');
const css = fs.readFileSync('css/popup.css', 'utf8');
const source = fs.readFileSync('js/popup/popup-updates.js', 'utf8');

assert(html.includes('id="updateNotice"')
    && html.includes('id="updateNoticeText"')
    && html.includes('id="downloadUpdateBtn"'),
'popup must provide one global update notice above its module tabs');
assert(html.indexOf('id="updateNotice"') < html.indexOf('<nav class="tabs-nav">'),
    'update notice must stay visible independently of the active module');
assert(html.indexOf('js/shared/update-check.js') < html.indexOf('js/popup/popup-updates.js'),
    'trusted metadata parser must load before the popup update controller');
assert(/\.update-notice\[hidden\]\s*\{[^}]*display:\s*none/s.test(css),
    'the notice must not reserve popup space when no update exists');
assert(source.includes('60 * 60 * 1000')
    && source.includes("cache: 'no-store'")
    && source.includes('AbortController'),
    'GitHub checks must be cached locally and have a bounded network lifetime');
assert(source.includes('text.textContent =') && !source.includes('innerHTML'),
    'release metadata must be rendered as text');
assert(source.includes('chrome.tabs.create({ url: release.downloadUrl })'),
    'the explicit user action must open the validated release asset');

console.log('PASS popup update notice is cached, safe and independent of module state');
