// DashBridge time-range state and Grafana URL transformations.
const DashBridgeRefreshIntervals = new Set(['', 'auto', '5s', '10s', '30s', '1m', '5m', '15m', '30m', '1h', '2h', '1d']);
const DashBridgeTimeState = {
    defaults() {
        return { from: 'now-1h', to: 'now', refresh: '' };
    },
    normalize(value, fallback = this.defaults()) {
        const source = value && typeof value === 'object' ? value : {};
        const fallbackRefresh = typeof fallback.refresh === 'string' && DashBridgeRefreshIntervals.has(fallback.refresh)
            ? fallback.refresh : '';
        return {
            from: typeof source.from === 'string' && source.from ? source.from : fallback.from,
            to: typeof source.to === 'string' && source.to ? source.to : fallback.to,
            refresh: typeof source.refresh === 'string' && DashBridgeRefreshIntervals.has(source.refresh)
                ? source.refresh : fallbackRefresh
        };
    },
    // Legacy global state is read only while old profiles are migrated.
    load() {
        try {
            return this.normalize({
                from: localStorage.getItem('dashbridge_timeFrom') || 'now-1h',
                to: localStorage.getItem('dashbridge_timeTo') || 'now',
                refresh: localStorage.getItem('dashbridge_refresh') || ''
            });
        } catch (_) { return this.defaults(); }
    },
    formatForInput(value) {
        if (!value || String(value).startsWith('now')) return value;
        const milliseconds = parseGrafanaAbsoluteTime(value);
        if (milliseconds === null) return value;
        const date = new Date(milliseconds);
        const pad = item => String(item).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    },
    formatForLabel(from, to) {
        const parse = value => {
            const match = String(this.formatForInput(value) || '').match(
                /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::\d{2})?$/
            );
            return match ? {
                year: match[1], month: match[2], day: match[3], hour: match[4], minute: match[5]
            } : null;
        };
        const start = parse(from);
        const end = parse(to);
        if (!start || !end) return `${this.formatForInput(from)} to ${this.formatForInput(to)}`;
        const startTime = `${start.hour}:${start.minute}`;
        const endTime = `${end.hour}:${end.minute}`;
        if (start.year === end.year && start.month === end.month && start.day === end.day) {
            return `${start.day}.${start.month}.${start.year} ${startTime}–${endTime}`;
        }
        if (start.year === end.year) {
            return `${start.day}.${start.month} ${startTime}–${end.day}.${end.month} ${endTime}`;
        }
        return `${start.day}.${start.month}.${start.year} ${startTime}–${end.day}.${end.month}.${end.year} ${endTime}`;
    },
    formatForUrl(urlValue, value) {
        const milliseconds = parseGrafanaAbsoluteTime(value);
        return milliseconds === null ? value : (serializeGrafanaAbsoluteTime(milliseconds, detectGrafanaTimeFormat(urlValue)) || value);
    },
    applyToUrl(urlValue, { from, to, refresh }) {
        try {
            const url = new URL(urlValue);
            url.searchParams.set('from', this.formatForUrl(urlValue, from));
            url.searchParams.set('to', this.formatForUrl(urlValue, to));
            const interval = DashBridgeRefreshIntervals.has(refresh) ? refresh : '';
            return globalThis.DashBridgeGrafanaPanelBootstrap?.applyRefreshPolicyToUrl?.(url.toString(), interval)
                || url.toString();
        } catch (_) { return urlValue; }
    }
};
