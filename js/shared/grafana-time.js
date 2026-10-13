// Absolute Grafana URL time parsing and serialization helpers.
(function (global) {
    const EPOCH_MILLISECONDS_RE = /^\d{13}$/;
    const ISO_8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
    const CALENDAR_RE = /^(?:(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})|(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4}))(?:[ T](\d{1,2})(?::(\d{2}))?(?::(\d{2})(?:[.,](\d+))?)?)?(Z|[+-]\d{2}:\d{2})?$/i;

    function calendarMilliseconds(match, dateOnlyAsUtc) {
        const year = Number(match[1] || match[6]), month = Number(match[2] || match[5]), day = Number(match[3] || match[4]);
        const hour = Number(match[7] || 0), minute = Number(match[8] || 0), second = Number(match[9] || 0);
        const millisecond = Number(String(match[10] || '').slice(0, 3).padEnd(3, '0'));
        const zone = match[11];
        const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
        const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        if (month < 1 || month > 12 || day < 1 || day > days[month - 1]
            || hour > 23 || minute > 59 || second > 59 || (zone && match[7] === undefined)) return null;
        let offset = 0;
        if (zone && zone.toUpperCase() !== 'Z') {
            const hours = Number(zone.slice(1, 3)), minutes = Number(zone.slice(4, 6));
            if (hours > 23 || minutes > 59) return null;
            offset = (zone[0] === '-' ? -1 : 1) * (hours * 60 + minutes);
        }
        const date = new Date(0);
        if (zone || dateOnlyAsUtc) {
            date.setUTCFullYear(year, month - 1, day);
            date.setUTCHours(hour, minute, second, millisecond);
            return date.getTime() - offset * 60000;
        }
        date.setFullYear(year, month - 1, day);
        date.setHours(hour, minute, second, millisecond);
        // Reject native rollover, including a nonexistent local hour during a DST gap.
        return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
            && date.getHours() === hour && date.getMinutes() === minute && date.getSeconds() === second
            ? date.getTime() : null;
    }

    function parseGrafanaAbsoluteTime(value, { numericDates = false } = {}) {
        const text = String(value || '').trim();
        const calendar = CALENDAR_RE.exec(text);
        if (calendar && (calendar[1] || numericDates)) {
            // Batch treats numeric date-only input as local; native ISO date-only
            // parsing in the existing URL/DashBridge contract means UTC midnight.
            return calendarMilliseconds(calendar, !numericDates && /^\d{4}-\d{2}-\d{2}$/.test(text));
        }
        // Native parsing also accepts +0300/GMT suffixes. Check their date
        // before falling back, otherwise the same February rollover escapes validation.
        const datePrefix = CALENDAR_RE.exec(text.split(/[ T]/i)[0]);
        if (datePrefix && (datePrefix[1] || numericDates) && calendarMilliseconds(datePrefix, true) === null) return null;
        const milliseconds = EPOCH_MILLISECONDS_RE.test(text) ? Number(text) : Date.parse(text);
        return Number.isFinite(milliseconds) ? milliseconds : null;
    }

    function isIsoGrafanaAbsoluteTime(value) {
        return ISO_8601_RE.test(String(value || '')) && parseGrafanaAbsoluteTime(value) !== null;
    }

    function parseGrafanaUrlTimeRange(urlValue) {
        try {
            const url = new URL(urlValue);
            const from = parseGrafanaAbsoluteTime(url.searchParams.get('from'));
            const to = parseGrafanaAbsoluteTime(url.searchParams.get('to'));
            return from !== null && to !== null && to >= from ? { from, to } : null;
        } catch {
            return null;
        }
    }

    function detectGrafanaTimeFormat(urlValue) {
        try {
            const url = new URL(urlValue);
            const from = url.searchParams.get('from');
            const to = url.searchParams.get('to');
            return isIsoGrafanaAbsoluteTime(from) && isIsoGrafanaAbsoluteTime(to)
                ? 'iso'
                : 'milliseconds';
        } catch {
            return 'milliseconds';
        }
    }

    function serializeGrafanaAbsoluteTime(milliseconds, format) {
        if (!Number.isFinite(milliseconds)) return null;
        return format === 'iso' ? new Date(milliseconds).toISOString() : String(milliseconds);
    }

    global.parseGrafanaAbsoluteTime = parseGrafanaAbsoluteTime;
    global.parseGrafanaUrlTimeRange = parseGrafanaUrlTimeRange;
    global.detectGrafanaTimeFormat = detectGrafanaTimeFormat;
    global.serializeGrafanaAbsoluteTime = serializeGrafanaAbsoluteTime;
})(globalThis);
