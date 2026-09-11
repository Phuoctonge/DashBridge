(function initDashBridgeFrameLoadController(root) {
    'use strict';

    const renderState = (frame, state, retry) => {
        const card = frame.closest('.panel-card');
        if (!card) return;
        card.querySelector('.frame-load-notice')?.remove();
        if (!state) return;
        const notice = card.ownerDocument.createElement('div');
        notice.className = 'frame-load-notice';
        notice.setAttribute('role', 'status');
        const label = card.ownerDocument.createElement('span');
        label.textContent = state === 'waiting' ? 'Подготовка подключения к Grafana…'
            : state === 'retrying' ? 'Восстанавливаем адрес графика…'
                : 'Grafana не вернулась к графику после обновления сессии.';
        notice.appendChild(label);
        if (state === 'error') {
            const button = card.ownerDocument.createElement('button');
            button.type = 'button';
            button.className = 'btn btn-outline';
            button.textContent = 'Повторить';
            button.addEventListener('click', event => { event.stopPropagation(); retry(); });
            notice.appendChild(button);
        }
        card.appendChild(notice);
    };

    function create({ navigate: navigateFrame, getPanelForIframe, showState = renderState,
        setTimer = setTimeout, clearTimer = clearTimeout,
        panelIdentity = root.DashBridgeGrafanaPanelIdentity,
        newId = () => crypto.randomUUID() } = {}) {
        if (typeof navigateFrame !== 'function' || typeof getPanelForIframe !== 'function' || !panelIdentity?.fromUrl) {
            throw new TypeError('Frame loading requires navigation and ownership adapters');
        }
        const records = new Map();
        const origins = new Map();
        const valid = record => records.get(record.frame) === record
            && record.frame.isConnected && !!getPanelForIframe(record.frame)
            && (!record.started || record.frame.src === record.url);
        const clearWatch = record => {
            clearTimer(record.deadline);
            clearTimer(record.poll);
            record.deadline = record.poll = null;
        };
        const release = record => {
            const group = origins.get(record.origin);
            if (!group || group.leader !== record) return;
            group.leader = null;
            group.open = true;
            const waiting = [...group.waiting];
            group.waiting.clear();
            waiting.forEach(next => {
                if (valid(next)) navigate(next.frame, next.frame.dataset.src || next.url);
                else cancel(next.frame);
            });
        };
        const cancel = frame => {
            const record = records.get(frame);
            if (!record) return;
            records.delete(frame);
            clearWatch(record);
            frame.removeEventListener('load', record.loaded);
            origins.get(record.origin)?.waiting.delete(record);
            delete frame.dataset.dashbridgeQueued;
            showState(frame, null);
            release(record);
        };
        const inspect = record => {
            if (!valid(record)) { cancel(record.frame); return; }
            if (record.stopped || !record.loadSeen) return;
            try {
                record.frame.contentWindow.postMessage({ action: 'dashbridgeInspectLocation',
                    requestId: record.token }, record.origin);
            } catch { /* The deadline releases the gate if navigation is still in progress. */ }
        };
        const poll = record => {
            inspect(record);
            if (records.get(record.frame) === record && !record.stopped) {
                record.poll = setTimer(() => poll(record), 500);
            }
        };
        const showError = record => {
            showState(record.frame, 'error', () => {
                if (valid(record)) navigate(record.frame, record.url);
            });
        };
        const start = record => {
            record.started = true;
            record.stopped = false;
            record.loadSeen = false;
            record.navigationConfirmed = false;
            delete record.frame.dataset.dashbridgeQueued;
            record.frame.removeAttribute('data-src');
            showState(record.frame, null);
            record.deadline = setTimer(() => {
                if (!valid(record)) { cancel(record.frame); return; }
                record.stopped = true;
                clearWatch(record);
                release(record);
                if (record.retries && !record.navigationConfirmed) showError(record);
            }, 30_000);
            record.poll = setTimer(() => poll(record), 500);
            navigateFrame(record.frame, record.url);
        };
        const makeRecord = (frame, value) => {
            cancel(frame);
            let url;
            try { url = new URL(value); } catch { return null; }
            if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
            const route = url.pathname.match(/^(.*\/)d(?:-solo)?\/([^/]+)\//);
            if (!route) return null;
            const record = { frame, url: url.href, origin: url.origin, base: route[1], identity: panelIdentity.fromUrl(url.href),
                token: newId(), retries: 0, started: false, stopped: false };
            record.loaded = () => {
                if (!record.started || record.stopped) return;
                record.loadSeen = true;
                inspect(record);
            };
            records.set(frame, record);
            frame.addEventListener('load', record.loaded);
            return record;
        };
        const navigate = (frame, url) => {
            if (!frame || !url) return;
            const record = makeRecord(frame, url);
            if (record) start(record);
            else navigateFrame(frame, url);
        };
        const schedule = (frame, url) => {
            const record = makeRecord(frame, url);
            if (!record) { navigateFrame(frame, url); return; }
            let group = origins.get(record.origin);
            if (!group) {
                group = { open: false, leader: record, waiting: new Set() };
                origins.set(record.origin, group);
                start(record);
            } else if (group.open) start(record);
            else {
                group.waiting.add(record);
                frame.dataset.src = record.url;
                frame.dataset.dashbridgeQueued = 'true';
                frame.dataset.dashbridgeLoaded = 'false';
                showState(frame, 'waiting');
            }
        };
        // The caller has already checked exact event.source/origin and active profile.
        const accept = (message, frame) => {
            const record = records.get(frame);
            if (!record || !valid(record) || !record.loadSeen || record.stopped
                || message?.requestId !== record.token || typeof message.url !== 'string'
                || message.url.length > 16384) return;
            let url;
            try { url = new URL(message.url); } catch { return; }
            if (url.origin !== record.origin) return;
            const expectedPanel = record.identity && panelIdentity.fromUrl(url.href) === record.identity;
            // HTTP navigation/redirects are complete before the expensive panel
            // queries and renderer. Release startup without declaring data ready;
            // the bounded watcher still handles a subsequent Home transition.
            if (expectedPanel && message.documentReady === true && message.home !== true && !record.navigationConfirmed) {
                record.navigationConfirmed = true;
                showState(frame, null);
                release(record);
            }
            if (expectedPanel && message.ready === true) {
                clearWatch(record);
                record.stopped = true;
                showState(frame, null);
                release(record);
                return;
            }
            if (url.pathname === `${record.base}login` || url.pathname.startsWith(`${record.base}login/`)) {
                clearWatch(record);
                record.stopped = true;
                showState(frame, null);
                release(record);
                return;
            }
            if (url.pathname !== record.base || message.home !== true) return;
            if (record.retries) {
                clearWatch(record);
                record.stopped = true;
                release(record);
                showError(record);
                return;
            }
            record.retries++;
            record.navigationConfirmed = false;
            record.token = newId();
            record.loadSeen = false;
            showState(frame, 'retrying');
            navigateFrame(frame, record.url);
        };
        const reset = () => {
            origins.clear();
            [...records.keys()].forEach(cancel);
        };
        return Object.freeze({ schedule, navigate, accept, cancel, reset });
    }
    root.DashBridgeFrameLoadController = Object.freeze({ create });
})(globalThis);
