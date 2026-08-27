// Pixel and archive helpers used by Batch capture workflows.
const BatchCaptureUtils = {
    base64ToUint8Array(base64) {
        const binary = window.atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
        return bytes;
    },
    createRunToken() {
        if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
        return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    },
    stableHash(value) {
        let hash = 0x811c9dc5;
        const source = String(value ?? '');
        for (let index = 0; index < source.length; index++) {
            hash ^= source.charCodeAt(index);
            hash = Math.imul(hash, 0x01000193);
        }
        return (hash >>> 0).toString(16).padStart(8, '0');
    },
    sanitizeFilenamePart(value, fallback = 'item', maxLength = 72) {
        const cleaned = String(value ?? '').normalize('NFKC')
            .replace(/[\u0000-\u001f\u007f\\/:*?"<>|\[\]]/g, '_')
            .replace(/\s+/g, '_')
            .replace(/_+/g, '_')
            .replace(/^[._-]+|[._-]+$/g, '');
        return (cleaned || fallback).slice(0, Math.max(1, maxLength));
    },
    buildCaptureFilename({ panelId, label, from, to, identity = '', runToken = '', occurrence = null }) {
        const panel = this.sanitizeFilenamePart(panelId, 'unknown', 24);
        const title = this.sanitizeFilenamePart(label, 'panel', 72);
        const range = `${this.sanitizeFilenamePart(from, 'from', 32)}_${this.sanitizeFilenamePart(to, 'to', 32)}`;
        const occurrencePart = Number.isInteger(occurrence) && occurrence >= 0 ? `_${occurrence}` : '';
        const hash = this.stableHash([runToken, identity, panelId, label, from, to, occurrence].join('\u0000'));
        const readable = `panel-${panel}_${title}${occurrencePart}_${range}`.slice(0, 168).replace(/[._-]+$/g, '');
        return `${readable}_${hash}.png`;
    },
    createFilenameFactory(runToken = this.createRunToken()) {
        const used = new Set();
        return options => {
            const original = this.buildCaptureFilename({ ...options, runToken });
            let candidate = original;
            let duplicate = 1;
            while (used.has(candidate)) {
                duplicate += 1;
                candidate = original.replace(/\.png$/i, `_${String(duplicate).padStart(3, '0')}.png`);
            }
            used.add(candidate);
            return candidate;
        };
    },
    formatRangeBoundary(value) {
        const source = String(value ?? '').trim();
        if (/^(?:\d{10}|\d{13})$/.test(source)) {
            const timestamp = Number(source) * (source.length === 10 ? 1000 : 1);
            const date = new Date(timestamp);
            if (!Number.isNaN(date.getTime())) {
                const pad = number => String(number).padStart(2, '0');
                return {
                    date: `${pad(date.getDate())}-${pad(date.getMonth() + 1)}`,
                    time: `${pad(date.getHours())}-${pad(date.getMinutes())}`
                };
            }
        }
        return { relative: this.sanitizeFilenamePart(source, 'time', 48) };
    },
    formatRangeFolder({ rangeIndex = 0, from = '', to = '' }) {
        const ordinal = String(Math.max(0, Number(rangeIndex) || 0) + 1).padStart(2, '0');
        const start = this.formatRangeBoundary(from);
        const end = this.formatRangeBoundary(to);
        if (start.date && end.date) {
            const endPart = start.date === end.date ? end.time : `${end.date}_${end.time}`;
            return `${ordinal}_from${start.date}_${start.time}_to${endPart}`;
        }
        const startPart = start.relative || `${start.date}_${start.time}`;
        const endPart = end.relative || `${end.date}_${end.time}`;
        return `${ordinal}_from${startPart}_to${endPart}`;
    },
    buildArchivePath({ filename, rangeIndex = 0, rangeCount = 1, from = '', to = '' }) {
        if (!Number.isInteger(rangeCount) || rangeCount <= 1) return filename;
        return `${this.formatRangeFolder({ rangeIndex, from, to })}/${filename}`;
    }
};
