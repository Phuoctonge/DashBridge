(function initReportCollage(root) {
    'use strict';

    const limits = Object.freeze({ panels: 8, pixels: 16_000_000, bytes: 64 * 1024 * 1024 });
    const checkAbort = signal => { if (signal?.aborted) throw new DOMException('Подготовка отменена', 'AbortError'); };

    function geometry(count, layout = 'auto', heading = '') {
        if (!Number.isInteger(count) || count < 1 || count > limits.panels) {
            throw new Error('Выберите от 1 до 8 панелей.');
        }
        if (!['auto', 'column', 'grid'].includes(layout)) throw new Error('Неизвестная раскладка.');
        const columns = count === 1 || layout === 'column' || (layout === 'auto' && count === 2) ? 1 : 2;
        const rows = Math.ceil(count / columns);
        const gap = 16;
        const header = heading ? 80 : 0;
        const width = columns * 1000 + (columns + 1) * gap;
        const height = header + rows * 568 + (rows + 1) * gap;
        if (width * height > limits.pixels) throw new Error('Изображение превышает лимит 16 мегапикселей.');
        return { columns, rows, width, height, gap, header };
    }

    const fitText = (context, value, maxWidth) => {
        const characters = Array.from(String(value || '').replace(/\s+/g, ' ').trim().slice(0, 1000));
        if (context.measureText(characters.join('')).width <= maxWidth) return characters.join('');
        while (characters.length && context.measureText(characters.join('') + '…').width > maxWidth) characters.pop();
        return characters.join('') + '…';
    };

    // Only trusted, locally captured PNGs enter this boundary; no DOM or Grafana access.
    async function compose(images, { layout = 'auto', heading = '', signal = null,
        documentRef = document, decode = blob => createImageBitmap(blob) } = {}) {
        checkAbort(signal);
        const grid = geometry(images?.length, layout, heading);
        let bytes = 0;
        for (const image of images) {
            if (!image?.blob || image.blob.type !== 'image/png' || image.blob.size <= 0
                || image.width !== 1000 || image.height !== 520) throw new Error('Некорректный PNG панели.');
            bytes += image.blob.size;
            if (bytes > limits.bytes) throw new Error('Снимки превышают лимит 64 МиБ.');
        }
        const canvas = documentRef.createElement('canvas');
        canvas.width = grid.width;
        canvas.height = grid.height;
        try {
            const context = canvas.getContext('2d');
            if (!context) throw new Error('Не удалось создать изображение.');
            context.fillStyle = '#f1f3f5';
            context.fillRect(0, 0, grid.width, grid.height);
            context.fillStyle = '#18222c';
            context.textBaseline = 'middle';
            if (heading) {
                context.font = '600 24px Arial, sans-serif';
                const lines = String(heading).split('\n').slice(0, 2);
                lines.forEach((line, index) => context.fillText(fitText(context, line, grid.width - 32), 16, 26 + index * 32));
            }
            for (let index = 0; index < images.length; index += 1) {
                checkAbort(signal);
                const source = images[index];
                const bitmap = await decode(source.blob);
                try {
                    checkAbort(signal);
                    if (bitmap.width !== 1000 || bitmap.height !== 520) throw new Error('Размер PNG не совпадает с ожидаемым.');
                    const x = grid.gap + (index % grid.columns) * (1000 + grid.gap);
                    const y = grid.header + grid.gap + Math.floor(index / grid.columns) * (568 + grid.gap);
                    context.fillStyle = '#ffffff';
                    context.fillRect(x, y, 1000, 568);
                    context.fillStyle = '#18222c';
                    context.font = '600 22px Arial, sans-serif';
                    context.fillText(fitText(context, source.title || 'Панель', 968), x + 16, y + 24);
                    context.drawImage(bitmap, x, y + 48);
                } finally { bitmap.close(); }
            }
            const blob = await new Promise((resolve, reject) => canvas.toBlob(value => {
                if (value) resolve(value);
                else reject(new Error('Не удалось сохранить PNG.'));
            }, 'image/png'));
            checkAbort(signal);
            if (blob.size > limits.bytes) throw new Error('Коллаж превышает лимит 64 МиБ.');
            return { blob, width: grid.width, height: grid.height };
        } finally {
            canvas.width = 0;
            canvas.height = 0;
        }
    }

    root.DashBridgeReportCollage = Object.freeze({ compose, geometry, limits });
})(globalThis);
