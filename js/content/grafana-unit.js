(function initDashBridgeGrafanaUnit(root) {
    'use strict';
    if (root.DashBridgeGrafanaUnit) return;

    // Grafana 12 Table's short formatter uses `Mil` for millions.
    const numericDisplayScale = token => ({ K: 1e3, M: 1e6, G: 1e9, T: 1e12, Mil: 1e6 })[
        token === 'Mil' ? token : token.toUpperCase()
    ];

    const parseAxisUnitLabel = label => {
        const match = String(label || '').trim().match(/^([-+]?[\d.,]+)\s*(.*)$/);
        if (!match) return null;
        const value = Number(match[1].replace(',', '.'));
        const suffix = match[2].trim();
        if (!Number.isFinite(value) || !suffix) return null;

        const binary = suffix.match(/^(Ki|Mi|Gi|Ti)B(?:\/.*)?$/i);
        if (binary) {
            const power = ({ ki: 1, mi: 2, gi: 3, ti: 4 })[binary[1].toLowerCase()];
            return { value, unit: suffix, factor: 1024 ** power };
        }

        const spacedSi = suffix.match(/^([kKmMgGtT])\s+(.+)$/);
        if (spacedSi) {
            const displayScale = ({ k: 1e3, m: 1e6, g: 1e9, t: 1e12 })[spacedSi[1].toLowerCase()];
            return { value, unit: spacedSi[2].trim(), factor: null, displayScale };
        }

        const compactBytes = suffix.match(/^([kKmMgGtT])B(?:\/.*)?$/);
        if (compactBytes) {
            const factor = ({ k: 1e3, m: 1e6, g: 1e9, t: 1e12 })[compactBytes[1].toLowerCase()];
            return { value, unit: suffix, factor };
        }

        // Grafana's `short` formatter labels a plain count as `3 K`.
        // `K` is a compact numeric scale here, not the measurement unit.
        const compactNumber = suffix.match(/^(Mil|[kKmMgGtT])$/);
        if (compactNumber) {
            const displayScale = numericDisplayScale(compactNumber[1]);
            return { value, unit: '', factor: null, displayScale };
        }

        return { value, unit: suffix, factor: null };
    };

    const inferUnitFromAxisLabels = (labels, yScale) => {
        const rawValues = [yScale?.min, yScale?.max];
        for (let index = 0; index < labels.length; index++) {
            const parsed = parseAxisUnitLabel(labels[index]);
            const raw = rawValues[index];
            if (!parsed || !Number.isFinite(raw) || parsed.value === 0) continue;
            return {
                unit: parsed.unit,
                factor: parsed.factor ?? raw / (parsed.value * (parsed.displayScale || 1))
            };
        }
        return null;
    };

    const inferUnitFromAxisTicks = ticks => {
        for (const tick of ticks || []) {
            const parsed = parseAxisUnitLabel(tick?.label);
            if (!parsed || !Number.isFinite(tick?.v) || parsed.value === 0) continue;
            return {
                unit: parsed.unit,
                factor: parsed.factor ?? tick.v / (parsed.value * (parsed.displayScale || 1))
            };
        }
        return null;
    };

    const unitFromPanelDefinition = panel => {
        // Grafana 11 Time series and Grafana 10 Stat use fieldConfig;
        // Grafana 10 legacy Graph keeps the unit in yaxes[0].format.
        const code = String(
            panel?.fieldConfig?.defaults?.unit
            || panel?.yaxes?.[0]?.format
            || ''
        ).trim();
        if (!code || /^(none|short)$/i.test(code)) return { unit: '', factor: 1, source: 'panel' };

        if (/^percentunit$/i.test(code)) return { unit: '%', factor: 0.01, source: 'panel', code };
        const known = {
            percent: '%',
            bytes: 'B',
            Bps: 'B/s',
            ms: 'ms',
            s: 's',
            opm: 'ops/m',
            ops: 'ops/s',
            reqps: 'req/s',
            reqpm: 'req/m',
            iops: 'IOPS'
        };
        const custom = code.match(/^(?:suffix|prefix):(.*)$/i);
        return { unit: custom ? custom[1] : (known[code] || code), factor: 1, source: 'panel', code };
    };

    const durationScaleMs = unit => {
        const token = String(unit || '').trim().replace(/μ/g, 'µ').toLowerCase();
        if (['µs', 'us', 'usec'].includes(token)) return 0.001;
        if (['ms', 'msec'].includes(token)) return 1;
        if (['s', 'sec', 'secs'].includes(token)) return 1000;
        if (['min', 'mins', 'minute', 'minutes'].includes(token)) return 60_000;
        if (['h', 'hr', 'hrs', 'hour', 'hours'].includes(token)) return 3_600_000;
        if (['d', 'day', 'days'].includes(token)) return 86_400_000;
        return null;
    };

    const configuredDurationScaleMs = code => {
        const token = String(code || '').trim().toLowerCase();
        if (['ms', 'dtdurationms', 'durationms'].includes(token)) return 1;
        if (['s', 'dtdurations', 'durations'].includes(token)) return 1000;
        return null;
    };

    // Convert a formatted cell to the report's unit, never discard a different suffix.
    const parseDisplayValue = (text, targetUnit = '') => {
        const normalized = String(text ?? '').trim().replace(/[−–]/g, '-').replace(/[\u00a0\u202f]/g, ' ')
            .replace(/(\d)\s+(?=\d)/g, '$1');
        const match = normalized.match(/^([-+]?(?:\d+(?:[.,]\d+)?|[.,]\d+)(?:e[-+]?\d+)?)\s*(.*?)$/i);
        if (!match) return null;
        const value = Number(match[1].replace(',', '.'));
        const from = match[2].trim();
        const to = String(targetUnit || '').trim();
        if (!Number.isFinite(value)) return null;
        if (!from || from === to) return value;
        const fromDuration = durationScaleMs(from), toDuration = durationScaleMs(to);
        if (fromDuration !== null && toDuration !== null) return value * fromDuration / toDuration;
        const byteScale = unit => {
            const parts = unit.match(/^([kKMGTPE]?)(i?)B(\/s)?$/);
            if (!parts) return null;
            const power = parts[1] ? 'KMGTPE'.indexOf(parts[1].toUpperCase()) + 1 : 0;
            return { scale: (parts[2] ? 1024 : 1000) ** power, rate: !!parts[3] };
        };
        const a = byteScale(from), b = byteScale(to);
        if (a && b && a.rate === b.rate) return value * a.scale / b.scale;
        const compact = from.match(/^(Mil|[kKMGT])(?:\s+(.*))?$/);
        if (compact && (compact[2] || '') === to) {
            return value * numericDisplayScale(compact[1]);
        }
        return null;
    };

    const mergeAxisAndPanelUnit = (axisUnit, panel) => {
        // Prefer visible axis scale whenever it exists: it converts a user
        // threshold in GiB/TiB or MB/s/GB/s to Grafana's raw value exactly.
        if (axisUnit && Number.isFinite(axisUnit.factor)) {
            const configured = unitFromPanelDefinition(panel);
            const displayScale = durationScaleMs(axisUnit.unit);
            const rawScale = configuredDurationScaleMs(configured.code);
            const exactFactor = displayScale !== null && rawScale !== null
                ? displayScale / rawScale : axisUnit.factor;
            return { ...axisUnit, factor: exactFactor, unit: axisUnit.unit || configured.unit, source: 'axis' };
        }
        return unitFromPanelDefinition(panel);
    };

    const collectDataFrameUnitCodes = data => {
        const units = new Set();
        for (const result of Object.values(data?.results || {})) {
            for (const frame of result?.frames || []) {
                for (const field of frame?.schema?.fields || []) {
                    if (field?.type === 'time') continue;
                    const unit = String(field?.config?.unit || '').trim();
                    if (unit) units.add(unit);
                    if (units.size >= 8) return [...units];
                }
            }
        }
        return [...units];
    };

    globalThis.DashBridgeGrafanaUnit = Object.freeze({
        parseAxisUnitLabel,
        parseDisplayValue,
        inferUnitFromAxisLabels,
        inferUnitFromAxisTicks,
        unitFromPanelDefinition,
        mergeAxisAndPanelUnit,
        collectDataFrameUnitCodes
    });
})(globalThis);
