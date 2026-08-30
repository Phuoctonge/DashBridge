(function initDashBridgeGrafanaTableReport(root) {
    'use strict';
    if (root.DashBridgeGrafanaTableReport) return;

    const parseAxisUnitLabel = root.DashBridgeGrafanaUnit?.parseAxisUnitLabel;
    if (!parseAxisUnitLabel) {
        throw new Error('DashBridgeGrafanaUnit must load before DashBridgeGrafanaTableReport');
    }

    const parseGrafanaTableDisplayValue = value => {
        const normalized = String(value || '').trim().replace(/[−–—]/g, '-');
        const plain = normalized.replace(/[  \s]/g, '').replace(',', '.');
        if (/^[-+]?\d+(?:\.\d+)?(?:e[-+]?\d+)?$/i.test(plain)) {
            const numeric = Number(plain);
            return Number.isFinite(numeric) ? numeric : null;
        }
        const parsed = parseAxisUnitLabel(normalized);
        if (!parsed) return null;
        const scale = Number(parsed.factor ?? parsed.displayScale ?? 1);
        const numeric = parsed.value * (Number.isFinite(scale) && scale > 0 ? scale : 1);
        return Number.isFinite(numeric) ? numeric : null;
    };

    const collectGrafanaTableRecords = (root = document) => {
        const textOf = element => String(element?.innerText ?? element?.textContent ?? '').trim();
        const cellsOf = row => {
            if (row?.cells?.length) return Array.from(row.cells);
            return Array.from(row?.querySelectorAll?.(':scope > [role="cell"], :scope > [role="gridcell"], :scope > [role="columnheader"], :scope > td, :scope > th') || []);
        };
        const candidates = [];
        if (root?.matches?.('table, [role="table"], [role="grid"]')) candidates.push(root);
        candidates.push(...Array.from(root?.querySelectorAll?.('table, [role="table"], [role="grid"]') || []));
        let best = [];
        for (const table of [...new Set(candidates)]) {
            const headerRow = table.querySelector?.('thead tr')
                || Array.from(table.querySelectorAll?.('[role="row"], tr') || [])
                    .find(row => row.querySelector?.('[role="columnheader"], th'));
            const headers = cellsOf(headerRow).map(cell => textOf(cell).replace(/\s+/g, ' '));
            let nameIndex = headers.findIndex(header => /^(?:metric|name|series|метрика|имя|серия|запрос)$/iu.test(header));
            const valueIndex = headers.findIndex(header => /^(?:value|current|last|значение|текущее(?: значение)?|количество|count)$/iu.test(header));
            if (nameIndex < 0 && valueIndex >= 0 && headers.length === 2) nameIndex = valueIndex === 0 ? 1 : 0;
            if (nameIndex < 0 || valueIndex < 0 || nameIndex === valueIndex) continue;
            const semanticRows = Array.from(table.querySelectorAll?.('tbody tr, [role="row"]') || []);
            const rows = semanticRows.length ? semanticRows : Array.from(table.querySelectorAll?.('tr') || []);
            const records = [];
            for (const row of [...new Set(rows)]) {
                if (row === headerRow || row.querySelector?.('[role="columnheader"], th')) continue;
                const cells = cellsOf(row);
                if (cells.length <= Math.max(nameIndex, valueIndex)) continue;
                const name = textOf(cells[nameIndex]);
                const numeric = parseGrafanaTableDisplayValue(textOf(cells[valueIndex]));
                if (!name || numeric === null) continue;
                records.push({ name, visible: true, values: [numeric] });
            }
            if (records.length > best.length) best = records;
        }
        return best;
    };

    globalThis.DashBridgeGrafanaTableReport = Object.freeze({
        parseGrafanaTableDisplayValue,
        collectGrafanaTableRecords
    });
})(globalThis);
