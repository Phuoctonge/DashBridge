'use strict';

const assert = require('assert');
const fs = require('fs');

const html = fs.readFileSync('pages/popup/popup.html', 'utf8');
const css = fs.readFileSync('pages/popup/popup.css', 'utf8');
const core = fs.readFileSync('pages/popup/popup-core.js', 'utf8');
const router = fs.readFileSync('pages/popup/popup-grafana-router.js', 'utf8');
const scrollRegionStart = html.indexOf('<main class="popup-scroll-region">');
const scrollRegionEnd = html.indexOf('</main>', scrollRegionStart);

assert(html.includes('<html lang="ru">')
    && !html.includes('popup-initializing')
    && !css.includes('popup-initializing'),
    'popup must not depend on a global asynchronous initialization style state');
assert(/body\s*\{[^}]*height:\s*auto;[^}]*min-height:\s*0;[^}]*max-height:\s*600px;/s.test(css),
    'popup must use natural active-tab height up to a safe 600px ceiling');
assert(/body\s*\{[^}]*width:\s*clamp\(352px,\s*22rem,\s*480px\)/s.test(css),
    'UI scale must not shrink the popup below its legacy 352px width');
assert(!/body\s*\{[^}]*max-width:\s*100vw/s.test(css),
    'action popup width must not be circularly capped by its initial narrow viewport');
assert(html.includes('<main class="popup-scroll-region">')
    && /body\s*\{[^}]*overflow:\s*hidden/s.test(css)
    && /\.popup-scroll-region\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto/s.test(css)
    && /\.app-header,\s*\.tabs-nav\s*\{[^}]*flex:\s*0 0 auto/s.test(css),
    'only overflowing tab content may shrink and scroll; popup navigation must remain fixed');
for (const id of ['tab-grafana', 'grafana-links', 'grafana-batch', 'grafana-debug',
    'tab-recorder', 'tab-jira', 'tab-tdm', 'tab-no-modules']) {
    const position = html.indexOf(`id="${id}"`);
    assert(position > scrollRegionStart && position < scrollRegionEnd,
        `${id} must use the shared popup scroll region`);
}
assert(!core.includes('dashbridge-popup-subtabs-ready')
    && !router.includes('dashbridge-popup-subtabs-ready')
    && !core.includes('getBoundingClientRect()')
    && !core.includes('requestAnimationFrame'),
    'popup startup must not coordinate speculative reveal events or force synchronous layout');
assert(!/\.tab-content\s*\{[^}]*animation\s*:/s.test(css) && !css.includes('@keyframes fadeIn'),
    'popup tab content must not start a compositor animation when initialization finishes');
assert(/body\s*\{[^}]*font-family:\s*-apple-system,\s*BlinkMacSystemFont/s.test(css),
    'popup must use an immediately available system font and avoid webfont reflow');
assert(/\.tab-content\s*\{[^}]*padding:\s*1rem 1rem 0\.25rem/s.test(css)
    && /\.tab-content\s*>\s*\.card:last-child\s*\{[^}]*margin-bottom:\s*0/s.test(css),
    'short popup tabs must not stack card margin and content padding into an empty footer gap');
assert(/\.grafana-timestamp-status:empty\s*\{[^}]*display:\s*none/s.test(css)
    && !/\.grafana-timestamp-status\s*\{[^}]*min-height:/s.test(css),
    'an empty timestamp status must not reserve space below the current-tab button');
for (const property of ['font-size', 'padding', 'gap', 'margin', 'border-radius']) {
    const fixedPixelGeometry = new RegExp(`${property}(?:-[a-z]+)?:\\s*[^;\"]*\\d+(?:\\.\\d+)?px`, 'i');
    assert(!fixedPixelGeometry.test(css) && !fixedPixelGeometry.test(html),
        `popup ${property} must scale through rem instead of fixed pixels`);
}
assert(/\.tab-btn\s*\{[^}]*padding:\s*0\.75rem 0\.375rem;[^}]*font-size:\s*0\.75rem/s.test(css)
    && /\.grafana-sub-btn\s*\{[^}]*padding:\s*0\.4375rem 0\.1875rem;[^}]*font-size:\s*0\.65625rem/s.test(css)
    && /input\[type="text"\],[^}]*padding:\s*0\.625rem;[^}]*font-size:\s*0\.8125rem/s.test(css),
    'tabs, subtabs and form controls must all respond to the shared UI scale');
assert(!html.includes('popup-tab-compact') && !css.includes('popup-tab-compact'),
    'natural popup height must apply uniformly instead of relying on per-tab exceptions');
assert(/\.grafana-sub-btn:focus\s*\{[^}]*outline:\s*none/s.test(css)
    && /\.grafana-sub-btn:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--primary\);[^}]*outline-offset:\s*2px/s.test(css),
    'Grafana subtabs must not alternate between browser-default and themed focus borders');
assert(core.includes('activateTab(targetTab, false)')
    && router.includes('activateSubTab(targetSub, false)')
    && !core.includes('activeTabBtn.click()')
    && !router.includes('activeSubBtn.click()'),
    'startup restoration must not synthesize user clicks or persistence writes');
assert(core.includes('module_recorder: true')
    && core.includes('"tab-recorder": modules.module_recorder'),
    'Recorder tab visibility must follow its Options module setting');
assert(html.includes('<rect x="3" y="5" width="18" height="14" rx="3" />')
    && html.includes('<circle cx="9" cy="12" r="3" fill="currentColor" stroke="none" />'),
    'Recorder must use a distinct recording icon instead of the Jira clock');
const buttonIcon = id => html.match(new RegExp(
    `<button[^>]*id="${id}"[\\s\\S]*?<svg[^>]*>([\\s\\S]*?)</svg>`
))?.[1].replace(/\s/g, '');
const sectionIcon = title => {
    const heading = [...html.matchAll(/<h3[^>]*class="section-title"[^>]*>[\s\S]*?<\/h3>/g)]
        .find(match => match[0].includes(title))?.[0] || '';
    return heading.match(/<svg[^>]*>([\s\S]*?)<\/svg>/)?.[1].replace(/\s/g, '');
};
const tabIcon = tab => html.match(new RegExp(
    `<button[^>]*class="tab-btn[^>]*data-tab="${tab}"[\\s\\S]*?<svg[^>]*>([\\s\\S]*?)</svg>`
))?.[1].replace(/\s/g, '');
assert(buttonIcon('openTrafficRecorderBtn')
    && buttonIcon('transferWorklogBtn')
    && buttonIcon('openTrafficRecorderBtn') !== buttonIcon('transferWorklogBtn'),
    'Traffic Recorder and WorkLog transfer must use distinct action icons');
assert(sectionIcon('Время для Django')
    && sectionIcon('Учет времени')
    && sectionIcon('Время для Django') !== sectionIcon('Учет времени'),
    'Django timestamp conversion must not reuse the Jira time-tracking icon');
assert(sectionIcon('Traffic Recorder')
    && tabIcon('tab-recorder')
    && sectionIcon('Traffic Recorder') === tabIcon('tab-recorder')
    && sectionIcon('Traffic Recorder') !== sectionIcon('Учет времени'),
    'Traffic Recorder must reuse its recording icon instead of the Jira clock');
assert(buttonIcon('grafanaTimestampReadBtn')
    && buttonIcon('grafanaTimestampReadBtn').includes('<rectx="3"y="4"width="18"height="16"rx="2"/>'),
    'the current-tab timestamp action must expose its own browser-import icon');
assert(buttonIcon('transferWorklogBtn')
    && buttonIcon('transferWorklogBtn').includes('<pathd="M57h11"/>')
    && buttonIcon('transferWorklogBtn').includes('<pathd="M1917H8"/>')
    && !buttonIcon('transferWorklogBtn').includes('<rect'),
    'WorkLog transfer must use a legible bidirectional-arrow icon at popup size');
for (const id of ['openBatchCaptureBtn', 'openTrafficRecorderBtn']) {
    const openingTag = html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`))?.[0] || '';
    assert(openingTag.includes('btn btn-outline popup-launch-btn'),
        `${id} must use the shared popup launch-button variant`);
    assert(!/style="[^"]*(?:background|border-color|color)\s*:/.test(openingTag),
        `${id} must not override the shared outline colour palette inline`);
}
assert(/\.popup-launch-btn\s*\{[^}]*font-size:\s*0\.75rem;[^}]*padding:\s*0\.75rem/s.test(css),
    'popup launch buttons must share compact geometry without duplicating colours');
const dashboardsStart = html.indexOf('Мои дашборды');
const dashboardsList = html.indexOf('id="customButtonsContainer"', dashboardsStart);
const dashboardsAddAction = html.indexOf('class="popup-dashboard-add-action"', dashboardsList);
const batchSection = html.indexOf('<!-- Подвкладка: Массовый сбор -->', dashboardsAddAction);
assert(dashboardsStart >= 0 && dashboardsList > dashboardsStart
    && dashboardsAddAction > dashboardsList && batchSection > dashboardsAddAction,
    'the add-link action must remain inside the My dashboards section after its rendered list');
assert(/\.popup-dashboard-add-action\s*\{[^}]*margin-top:\s*0\.75rem;[^}]*padding-top:\s*0\.75rem;[^}]*border-top:\s*1px solid var\(--border-light\)/s.test(css)
    && /\.popup-dashboard-add-action \.btn\s*\{[^}]*font-size:\s*0\.75rem;[^}]*padding:\s*0\.625rem/s.test(css),
    'the add-link action must use a themed divider and shared compact geometry');
assert(html.includes('class="tdm-toggle-row tdm-toggle-row-first"')
    && html.includes('id="tdmFilterUserContainer" class="tdm-user-filter"')
    && css.includes('grid-template-columns: minmax(0, 1fr) auto;')
    && css.includes('.tdm-toggle-row .switch'),
    'TDM switches must share one right-aligned grid column');

console.log('PASS popup uses responsive controls, natural tab height and bounded scrolling');
