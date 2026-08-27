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
    globalThis.DashBridgeGrafanaCaptureOutput = Object.freeze({ normalizeOutputSize, fitPreparedSize, crop, copy, filename });
})();
