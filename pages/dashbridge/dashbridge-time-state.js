// DashBridge time-range state and Grafana URL transformations.
const DashBridgeRefreshIntervals = new Set(['', 'auto', '5s', '10s', '30s', '1m', '5m', '15m', '30m', '1h', '2h', '1d']);
const DashBridgeTimeState = {
    defaults() {
        return { from: 'now-1h', to: 'now', refresh: '' };
    },
    // Use one clock reading for both endpoints; ambiguous calendar math needs
    // an explicit absolute range rather than a browser-timezone approximation.
    forReport(value, now = Date.now()) {
        const resolve = input => {
            if (input === 'now') return String(now);
            const relative = /^now([+-])(\d+)([smhdw])$/.exec(String(input));
            if (relative) {
                const units = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };
                const result = now + (relative[1] === '-' ? -1 : 1) * Number(relative[2]) * units[relative[3]];
                if (Number.isFinite(new Date(result).getTime())) return String(result);
            }
            const absolute = parseGrafanaAbsoluteTime(input);
            if (absolute !== null) return String(absolute);
            throw new Error('Для общего отчёта выберите абсолютный период или диапазон вида now-1h - now без округления.');
        };
        const from = resolve(value.from), to = resolve(value.to);
        if (Number(from) > Number(to)) throw new Error('Начало периода позже окончания.');
        return { from, to, refresh: '' };
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
    formatForUrl(_urlValue, value) {
        const milliseconds = parseGrafanaAbsoluteTime(value);
        // Grafana 12.2 solo ignores ISO URL endpoints and queries a fallback range.
        // Use epoch milliseconds for navigation and time updates; keep datemath intact.
        return milliseconds === null ? value : String(milliseconds);
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
