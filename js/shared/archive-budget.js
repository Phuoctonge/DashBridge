globalThis.DashBridgeArchiveBudget = Object.freeze({
    create(maxBytes) {
        let usedBytes = 0;
        return {
            reserve(bytes, label = 'file') {
                const size = Math.max(0, Number(bytes) || 0);
                if (usedBytes + size > maxBytes) throw new RangeError(`Лимит памяти архива превышен перед добавлением ${label}. Разделите сбор на несколько архивов.`);
                usedBytes += size;
                return usedBytes;
            },
            get usedBytes() { return usedBytes; },
            get maxBytes() { return maxBytes; }
        };
    },
    estimateBase64Bytes(value) { return Math.floor(String(value || '').replace(/\s/g, '').length * 3 / 4); }
});
