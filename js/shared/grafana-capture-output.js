(() => {
    'use strict';
    if (globalThis.DashBridgeGrafanaCaptureOutput) return;

    const loadImage = source => new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('capture-image-decode-failed'));
        image.src = source;
    });
    const canvasToBlob = canvas => new Promise((resolve, reject) => canvas.toBlob(
        blob => blob ? resolve(blob) : reject(new Error('capture-png-encode-failed')), 'image/png'
    ));
    const normalizeOutputSize = (value, fallback = { width: 1000, height: 520 }) => {
        const dimension = (candidate, defaultValue) => {
            const number = Number(candidate);
            return Number.isFinite(number) && number >= 100 && number <= 4096
                ? Math.round(number)
                : defaultValue;
        };
        return {
            width: dimension(value?.width, fallback.width),
            height: dimension(value?.height, fallback.height)
        };
    };
    const fitPreparedSize = ({ viewportWidth, viewportHeight, outputWidth = 1000, outputHeight = 520, margin = 12 }) => {
        const availableWidth = Math.max(1, Number(viewportWidth) - margin * 2);
        const availableHeight = Math.max(1, Number(viewportHeight) - margin * 2);
        const target = normalizeOutputSize({ width: outputWidth, height: outputHeight });
        const targetWidth = target.width;
        const targetHeight = target.height;
        // Render at the requested CSS size whenever it fits. Enlarging to the
        // viewport and downscaling afterwards makes Grafana labels unreadably small.
        const scale = Math.min(1, availableWidth / targetWidth, availableHeight / targetHeight);
        const width = targetWidth * scale;
        const height = targetHeight * scale;
        return {
            width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)),
            left: Math.max(margin, Math.round((Number(viewportWidth) - width) / 2)),
            top: Math.max(margin, Math.round((Number(viewportHeight) - height) / 2))
        };
    };
    // Layout evidence is advisory: an unfamiliar renderer or a stalled RAF
    // must not break save/copy. Only cancellation rejects the capture.
    const waitForStableLayout = (root = null, { signal } = {}) => new Promise((resolve, reject) => {
        const view = globalThis;
        const documentRef = view.document;
        if (signal?.aborted) { reject(new Error('capture-cancelled')); return; }
        if (typeof view.requestAnimationFrame !== 'function' || !documentRef) {
            resolve({ status: 'unavailable' });
            return;
        }
        let frameId = null;
        let timerId = null;
        let finished = false;
        let stable = 0;
        let previous = null;
        const finish = (status, error = null) => {
            if (finished) return;
            finished = true;
            if (frameId != null) view.cancelAnimationFrame(frameId);
            if (timerId != null) view.clearTimeout(timerId);
            view.removeEventListener('visibilitychange', onVisibility);
            view.removeEventListener('pagehide', onAbort);
            signal?.removeEventListener('abort', onAbort);
            error ? reject(error) : resolve({ status });
        };
        const onAbort = () => finish('cancelled', new Error('capture-cancelled'));
        const onVisibility = () => {
            if (documentRef.visibilityState === 'hidden') finish('hidden');
        };
        const sample = () => {
            if (!root) return [];
            const nodes = [root, ...Array.from(root.querySelectorAll?.(
                'canvas, .uplot, .graph-panel, .u-legend, table, [role="table"]'
            ) || []).slice(0, 24)];
            return nodes.map(node => {
                const bounds = node.getBoundingClientRect();
                return { node, values: [bounds.left, bounds.top, bounds.width, bounds.height,
                    node.width || 0, node.height || 0].map(value => Math.round(value * 2) / 2).join(',') };
            });
        };
        const inspect = () => {
            frameId = null;
            if (finished) return;
            if (signal?.aborted) return onAbort();
            if (documentRef.visibilityState === 'hidden') return finish('hidden');
            try {
                const current = sample();
                const unchanged = previous && current.length === previous.length
                    && current.every((item, index) => item.node === previous[index].node
                        && item.values === previous[index].values);
                stable = unchanged ? stable + 1 : 0;
                previous = current;
                if (stable >= 3) return finish('stable');
                frameId = view.requestAnimationFrame(inspect);
            } catch (_) { finish('unavailable'); }
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        view.addEventListener('visibilitychange', onVisibility);
        view.addEventListener('pagehide', onAbort, { once: true });
        timerId = view.setTimeout(() => finish('deadline'), 2000);
        if (documentRef.visibilityState === 'hidden') return finish('hidden');
        frameId = view.requestAnimationFrame(inspect);
    });
    const crop = async (source, rect, outputSize = null) => {
        const image = await loadImage(source);
        const dpr = Number(rect?.dpr) || 1;
        const x = Math.max(0, Math.round((Number(rect?.x) || 0) * dpr));
        const y = Math.max(0, Math.round((Number(rect?.y) || 0) * dpr));
        const width = Math.min(Math.round((Number(rect?.width) || 0) * dpr), image.naturalWidth - x);
        const height = Math.min(Math.round((Number(rect?.height) || 0) * dpr), image.naturalHeight - y);
        if (width <= 1 || height <= 1) throw new Error('capture-panel-outside-viewport');
        const canvas = document.createElement('canvas');
        const normalizedOutput = outputSize ? normalizeOutputSize(outputSize) : null;
        canvas.width = normalizedOutput?.width || width;
        canvas.height = normalizedOutput?.height || height;
        canvas.getContext('2d').drawImage(image, x, y, width, height, 0, 0, canvas.width, canvas.height);
        const blob = await canvasToBlob(canvas);
        return { blob, dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
    };
    const copy = async blob => {
        if (!navigator.clipboard?.write || typeof ClipboardItem !== 'function') throw new Error('clipboard-image-unavailable');
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    };
    const filename = title => {
        const clean = String(title || 'panel').toLowerCase()
            .replace(/[^a-z0-9а-яё]+/gi, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 120) || 'panel';
        return `grafana_${clean}_${new Date().toISOString().slice(0, 10)}.png`;
    };
    globalThis.DashBridgeGrafanaCaptureOutput = Object.freeze({ normalizeOutputSize, fitPreparedSize,
        waitForStableLayout, crop, copy, filename });
})();
