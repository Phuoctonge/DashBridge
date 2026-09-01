(function initRecorderSessionTransport(root) {
    'use strict';

    function create({ state, refreshIncognitoAccess, cdpVersion,
        maxBodyBytes, maxRequestBodyBytes, chromeRef = chrome,
        screenRef = globalThis.screen, setIntervalRef = setInterval }) {
        if (!state || typeof refreshIncognitoAccess !== 'function'
            || typeof cdpVersion !== 'string' || !cdpVersion
            || !Number.isFinite(maxBodyBytes) || !Number.isFinite(maxRequestBodyBytes)
            || typeof chromeRef?.runtime?.connect !== 'function'
            || typeof chromeRef?.debugger?.sendCommand !== 'function'
            || typeof chromeRef?.debugger?.attach !== 'function'
            || typeof chromeRef?.debugger?.detach !== 'function'
            || typeof chromeRef?.windows?.getAll !== 'function'
            || typeof chromeRef?.windows?.create !== 'function'
            || typeof chromeRef?.scripting?.executeScript !== 'function'
            || typeof setIntervalRef !== 'function') {
            throw new TypeError('Recorder session transport dependencies are incomplete');
        }

        let lifecyclePort = null;

        const connectLifecyclePort = () => {
            try {
                const port = chromeRef.runtime.connect({
                    name: 'dashbridge-recorder-lifecycle',
                });
                lifecyclePort = port;
                port.onDisconnect.addListener(() => {
                    void chromeRef.runtime.lastError;
                    if (lifecyclePort === port) lifecyclePort = null;
                });
                return port;
            } catch (_) {
                lifecyclePort = null;
                return null;
            }
        };

        const postLifecycle = message => {
            try {
                const wasConnected = Boolean(lifecyclePort);
                const connected = lifecyclePort || connectLifecyclePort();
                if (!connected) return false;
                if (!wasConnected && state.attached && message?.type !== 'bind') {
                    connected.postMessage({ type: 'bind', tabId: state.tabId });
                }
                connected.postMessage(message);
                return true;
            } catch (_) {
                lifecyclePort = null;
                return false;
            }
        };

        connectLifecyclePort();
        setIntervalRef(() => {
            if (state.attached) postLifecycle({ type: 'heartbeat' });
        }, 20_000);

        const debuggerTarget = () => ({ tabId: state.tabId });
        const sendCdp = (method, params = {}) => (
            chromeRef.debugger.sendCommand(debuggerTarget(), method, params)
        );

        const ensureDebuggerPermission = async () => {
            // Chrome does not permit `debugger` in optional_permissions. The API is
            // declared at install time but is attached only from Record/Replay.
            return true;
        };

        const attachNetwork = async tabId => {
            state.tabId = tabId;
            await chromeRef.debugger.attach({ tabId }, cdpVersion);
            state.attached = true;
            postLifecycle({ type: 'bind', tabId });
            await Promise.all([
                sendCdp('Network.enable', {
                    maxTotalBufferSize: 100 * 1024 * 1024,
                    maxResourceBufferSize: maxBodyBytes,
                    maxPostDataSize: maxRequestBodyBytes,
                }),
                sendCdp('Page.enable'),
            ]);
            await sendCdp('Page.setLifecycleEventsEnabled', { enabled: true })
                .catch(() => undefined);
            await Promise.all([
                sendCdp('Network.setCacheDisabled', {
                    cacheDisabled: state.sessionOptions.disableCache,
                }),
                sendCdp('Network.setBypassServiceWorker', {
                    bypass: state.sessionOptions.disableCache,
                }),
            ]);
        };

        const detachNetwork = async () => {
            if (!state.attached || !Number.isInteger(state.tabId)) return;
            const target = { tabId: state.tabId };
            state.attached = false;
            state.detaching = true;
            postLifecycle({ type: 'unbind' });
            try {
                await chromeRef.debugger.detach(target).catch(() => undefined);
            } finally {
                state.detaching = false;
            }
        };

        const assertIncognitoReady = async () => {
            if (!state.sessionOptions.disableCookies) return;
            const allowed = await refreshIncognitoAccess();
            if (!allowed) {
                throw new Error('Для Disable Cookies включите «Разрешить использование в режиме инкогнито» в настройках расширения Chrome');
            }
            const windows = await chromeRef.windows.getAll({ populate: false });
            if (windows.some(windowInfo => windowInfo.incognito)) {
                throw new Error('Закройте остальные окна инкогнито: Chrome использует для них общее cookie-хранилище');
            }
        };

        const buildWindowLayout = () => {
            const availableLeft = Number.isFinite(screenRef?.availLeft)
                ? Math.round(screenRef.availLeft) : 0;
            const availableTop = Number.isFinite(screenRef?.availTop)
                ? Math.round(screenRef.availTop) : 0;
            const availableWidth = Math.max(
                0, Math.round(Number(screenRef?.availWidth) || 0),
            );
            const availableHeight = Math.max(
                0, Math.round(Number(screenRef?.availHeight) || 0),
            );
            return {
                controlled: availableWidth >= 720 && availableHeight >= 500 ? {
                    left: availableLeft,
                    top: availableTop,
                    width: availableWidth,
                    height: availableHeight,
                    state: 'normal',
                } : null,
            };
        };

        const createControlledTab = async (layout = null) => {
            await assertIncognitoReady();
            const created = await chromeRef.windows.create({
                url: 'about:blank',
                type: 'normal',
                focused: true,
                incognito: state.sessionOptions.disableCookies,
                ...(layout?.controlled || {}),
            });
            const tab = created.tabs?.[0];
            if (!Number.isInteger(created.id) || !Number.isInteger(tab?.id)) {
                throw new Error('Не удалось открыть контролируемую вкладку');
            }
            state.windowId = created.id;
            return tab.id;
        };

        const injectActionRecorder = async () => {
            if (!['recording', 'replaying'].includes(state.mode)
                || !Number.isInteger(state.tabId)) return;
            await chromeRef.scripting.executeScript({
                target: { tabId: state.tabId, allFrames: true },
                files: ['js/content/scenario-recorder.js'],
            }).catch(() => undefined);
        };

        return Object.freeze({
            postLifecycle,
            sendCdp,
            ensureDebuggerPermission,
            attachNetwork,
            detachNetwork,
            buildWindowLayout,
            createControlledTab,
            injectActionRecorder,
        });
    }

    root.DashBridgeRecorderSessionTransport = Object.freeze({ create });
})(globalThis);
