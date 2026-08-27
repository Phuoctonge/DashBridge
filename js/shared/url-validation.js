// Normalises a hostname from an http(s) URL or a hostname-only value.
// Returns host (hostname:port) to preserve non-standard ports.
globalThis.parseHttpUrl = value => {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
        const raw = value.trim();
        const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !url.hostname) return null;
        if (url.hostname.endsWith('.')) url.hostname = url.hostname.slice(0, -1);
        return url;
    } catch {
        return null;
    }
};

globalThis.normalizeHttpHost = value => {
    const url = globalThis.parseHttpUrl(value);
    return url ? url.host.toLowerCase() : null;
};

globalThis.normalizeHttpOrigin = value => {
    const url = globalThis.parseHttpUrl(value);
    return url ? url.origin.toLowerCase() : null;
};

globalThis.normalizeHttpBaseOrigin = value => {
    const url = globalThis.parseHttpUrl(value);
    if (!url || (url.pathname && url.pathname !== '/') || url.search || url.hash) return null;
    return url.origin.toLowerCase();
};

// Canonical HTTP base URL for applications installed below an origin root
// (for example https://host.example/jira). Query and fragment are forbidden.
globalThis.normalizeHttpBaseUrl = value => {
    const url = globalThis.parseHttpUrl(value);
    if (!url || url.search || url.hash) return null;
    const pathname = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
    return `${url.origin.toLowerCase()}${pathname}`;
};
