// Absolute Grafana URL time parsing and serialization helpers.
(function (global) {
    const EPOCH_MILLISECONDS_RE = /^\d{13}$/;
    const ISO_8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

    function parseGrafanaAbsoluteTime(value) {
        const text = String(value || '');
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
