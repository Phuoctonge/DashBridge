(function initRecorderActionCapture(root) {
    'use strict';

    function create({ state, schema, setStatus, scheduleRender,
        maxActionValue = 1024 * 1024, now = () => Date.now() }) {
        if (!state || typeof schema?.normalizeHttpUrl !== 'function'
            || !Number.isFinite(schema?.MAX_FLOW_STEPS)
            || typeof setStatus !== 'function' || typeof scheduleRender !== 'function'
            || !Number.isFinite(maxActionValue) || typeof now !== 'function') {
            throw new TypeError('Recorder action capture dependencies are incomplete');
        }

        const claimRequestsForStep = (stepId, startedAt) => {
            const boundary = Math.max(0, Number(startedAt) || now());
            for (const request of state.requests.values()) {
                const requestAt = Number(request.wallTime) * 1000;
                if (Number.isFinite(requestAt) && requestAt >= boundary - 50) request.stepId = stepId;
            }
        };

        const addNavigateStep = (url, at = now()) => {
            const normalized = schema.normalizeHttpUrl(url);
            if (!normalized) return;
            const previous = state.steps[state.steps.length - 1];
            if (previous?.type === 'navigate' && previous.url === normalized) return;
            const previousAt = Number(previous?._dashbridge?.at || 0);
            if (previous && at - previousAt >= 0 && at - previousAt < 5_000) {
                if (previous.type === 'navigate') {
                    previous._dashbridge.finalUrl = normalized; scheduleRender(); return;
                }
                if (['click', 'keyDown'].includes(previous.type)) {
                    previous._dashbridge.navigationUrl = normalized; scheduleRender(); return;
                }
            }
            if (state.steps.length >= schema.MAX_FLOW_STEPS) {
                setStatus(`Достигнут лимит ${schema.MAX_FLOW_STEPS} шагов`, true);
                return;
            }
            state.steps.push({
                type: 'navigate', url: normalized,
                _dashbridge: { at, sequence: ++state.actionSequence },
            });
            state.activeStepId = state.steps.length;
            claimRequestsForStep(state.activeStepId, at);
            scheduleRender();
        };

        const selectorList = locator => {
            const selectors = [];
            if (locator?.id) selectors.push([`id/${locator.id}`]);
            if (locator?.testId) selectors.push([`${locator.testAttribute || 'data-testid'}/${locator.testId}`]);
            if (locator?.ariaLabel) selectors.push([`aria/${locator.ariaLabel}`]);
            if (locator?.role && locator?.accessibleName) selectors.push([`role/${locator.role}/${locator.accessibleName}`]);
            if (locator?.href) selectors.push([`href/${locator.href}`]);
            if (locator?.text) selectors.push([`text/${locator.text}`]);
            if (locator?.css) selectors.push([locator.css]);
            return selectors;
        };

        const addRecordedAction = (action, frameId) => {
            if (state.mode !== 'recording' || !action || typeof action !== 'object') return;
            if (!['click', 'change', 'keyDown', 'submit'].includes(action.type) || !action.locator?.css) return;
            if (state.steps.length >= schema.MAX_FLOW_STEPS) {
                setStatus(`Достигнут лимит ${schema.MAX_FLOW_STEPS} шагов`, true);
                return;
            }
            const previousBeforeAdd = state.steps[state.steps.length - 1];
            if (action.type === 'submit' && previousBeforeAdd?.type === 'click'
                && Number(action.at || 0) - Number(previousBeforeAdd._dashbridge?.at || 0) < 1_000) return;
            const base = {
                type: action.type,
                selectors: selectorList(action.locator),
                target: 'main',
                _dashbridge: {
                    at: Math.max(0, Number(action.at) || now()), sequence: ++state.actionSequence,
                    locator: action.locator, frameUrl: String(action.frameUrl || '').slice(0, 4096), frameId,
                    secret: action.secret === true,
                },
            };
            if (action.type === 'change') {
                base.value = typeof action.value === 'string' ? action.value.slice(0, maxActionValue) : action.value;
            }
            if (action.type === 'keyDown') base.key = String(action.key || '').slice(0, 30);
            const previous = state.steps[state.steps.length - 1];
            const sameChange = base.type === 'change' && previous?.type === 'change'
                && previous._dashbridge?.frameUrl === base._dashbridge.frameUrl
                && previous._dashbridge?.locator?.css === base._dashbridge.locator.css
                && base._dashbridge.at - Number(previous._dashbridge?.at || 0) < 2_000;
            if (sameChange) state.steps[state.steps.length - 1] = base;
            else state.steps.push(base);
            state.activeStepId = state.steps.length;
            claimRequestsForStep(state.activeStepId, base._dashbridge.at);
            scheduleRender();
        };

        return Object.freeze({ addNavigateStep, addRecordedAction, selectorList, claimRequestsForStep });
    }

    root.DashBridgeRecorderActionCapture = Object.freeze({ create });
})(globalThis);
