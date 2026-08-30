(function initDashBridgeGrafanaUnit(root) {
    'use strict';
    if (root.DashBridgeGrafanaUnit) return;

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
        const compactNumber = suffix.match(/^([kKmMgGtT])$/);
        if (compactNumber) {
            const displayScale = ({ k: 1e3, m: 1e6, g: 1e9, t: 1e12 })[compactNumber[1].toLowerCase()];
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

        const known = {
            percent: '%',
            percentunit: '%',
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

    const mergeAxisAndPanelUnit = (axisUnit, panel) => {
        // Prefer visible axis scale whenever it exists: it converts a user
        // threshold in GiB/TiB or MB/s/GB/s to Grafana's raw value exactly.
        if (axisUnit && Number.isFinite(axisUnit.factor)) {
            const configured = unitFromPanelDefinition(panel);
            return { ...axisUnit, unit: axisUnit.unit || configured.unit, source: 'axis' };
        }
        return unitFromPanelDefinition(panel);
    };

    globalThis.DashBridgeGrafanaUnit = Object.freeze({
        parseAxisUnitLabel,
        inferUnitFromAxisLabels,
        inferUnitFromAxisTicks,
        unitFromPanelDefinition,
        mergeAxisAndPanelUnit
    });
})(globalThis);
