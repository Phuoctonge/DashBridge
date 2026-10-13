(function initDashBridgeGrafanaTableReport(root) {
    'use strict';
    if (root.DashBridgeGrafanaTableReport) return;

    const unitParser = root.DashBridgeGrafanaUnit;
    if (!unitParser?.parseAxisUnitLabel) {
        throw new Error('DashBridgeGrafanaUnit must load before DashBridgeGrafanaTableReport');
    }

    const parseGrafanaTableDisplayValue = value => {
        // Without a requested unit, classify only canonical supported scales.
        // Unknown suffixes cannot become a plain count with factor 1.
        for (const unit of ['', 'B', 'B/s', 'ms', '%']) {
            const numeric = unitParser.parseDisplayValue(value, unit);
            if (numeric !== null) return numeric;
        }
        return null;
    };

    const getResponseTableFrameShape = frame => {
        const fields = frame?.schema?.fields || [];
        const columns = frame?.data?.values || [];
        const normalizedName = field => String(field?.config?.displayName || field?.name || '').trim();
        const nameIndex = fields.findIndex(field => /^(?:metric|name|series|метрика|имя|серия|запрос)$/iu.test(normalizedName(field))
            && field.type !== 'number');
        const exactValueIndex = fields.findIndex((field, index) => /^(?:value|current|last|значение|текущее(?: значение)?|количество|count)$/iu.test(normalizedName(field))
            && (field.type === 'number' || Array.from(columns[index] || []).some(Number.isFinite)));
        const numericIndexes = fields.map((field, index) => field.type === 'number'
            || Array.from(columns[index] || []).some(Number.isFinite) ? index : -1).filter(index => index >= 0);
        const valueIndex = exactValueIndex >= 0 ? exactValueIndex : (numericIndexes.length === 1 ? numericIndexes[0] : -1);
        if (nameIndex < 0 || valueIndex < 0 || nameIndex === valueIndex) return null;
        const rowCount = Math.min(columns[nameIndex]?.length || 0, columns[valueIndex]?.length || 0);
        if (!rowCount) return null;
        const timeIndexes = fields.map((field, index) => field.type === 'time' || field.name === 'Time' ? index : -1)
            .filter(index => index >= 0);
        return { fields, columns, nameIndex, valueIndex, rowCount, timeIndexes };
    };

    const TABLE_ROW_LIMIT = 100;
    const textOf = element => String(element?.innerText ?? element?.textContent ?? '').trim();
    const cellsOf = row => {
        if (row?.cells?.length) return Array.from(row.cells);
        return Array.from(row?.querySelectorAll?.(':scope > [role="cell"], :scope > [role="gridcell"], :scope > [role="columnheader"], :scope > td, :scope > th') || []);
    };

    const collectGrafanaTableData = (root = document) => {
        const candidates = [];
        if (root?.matches?.('table, [role="table"], [role="grid"]')) candidates.push(root);
        candidates.push(...Array.from(root?.querySelectorAll?.('table, [role="table"], [role="grid"]') || []));
        let best = null;
        for (const table of [...new Set(candidates)]) {
            const headerRow = table.querySelector?.('thead tr')
                || Array.from(table.querySelectorAll?.('[role="row"], tr') || [])
                    .find(row => row.querySelector?.('[role="columnheader"], th'));
            const columns = cellsOf(headerRow).map(cell => textOf(cell).replace(/\s+/g, ' '));
            if (columns.length < 2) continue;
            const semanticRows = Array.from(table.querySelectorAll?.('tbody tr, [role="row"]') || []);
            const rows = semanticRows.length ? semanticRows : Array.from(table.querySelectorAll?.('tr') || []);
            const displayRows = [];
            for (const row of [...new Set(rows)]) {
                if (row === headerRow || row.querySelector?.('[role="columnheader"], th')) continue;
                // Native Data Grid totals are aggregates, not datasource rows.
                if (row.matches?.('.rdg-summary-row, .rdg-bottom-summary-row, .rdg-top-summary-row')) continue;
                const values = cellsOf(row).slice(0, columns.length).map(textOf);
                if (values.some(Boolean)) {
                    // Missing cells remain visible to the completeness check.
                    while (values.length < columns.length) values.push('');
                    displayRows.push(values);
                }
            }
            if (!displayRows.length || best && displayRows.length <= best.totalRows) continue;
            const visibleRows = displayRows.slice(0, TABLE_ROW_LIMIT);
            const numericColumns = columns.map((_column, index) => visibleRows.some(row => row[index])
                && visibleRows.every(row => !row[index] || parseGrafanaTableDisplayValue(row[index]) !== null));
            best = {
                columns: columns.slice(0, 20),
                rows: visibleRows.map(row => row.slice(0, 20)),
                numericColumns: numericColumns.slice(0, 20),
                totalRows: displayRows.length,
                truncated: displayRows.length > TABLE_ROW_LIMIT || columns.length > 20,
                source: 'dom'
            };
        }
        return best;
    };

    const collectGrafanaTableRecords = (root = document, { unit, table = collectGrafanaTableData(root) } = {}) => {
        if (!table) return [];
        let nameIndex = table.columns.findIndex(header => /^(?:metric|name|series|метрика|имя|серия|запрос)$/iu.test(header));
        const valueIndex = table.columns.findIndex(header => /^(?:value|current|last|значение|текущее(?: значение)?|количество|count)$/iu.test(header));
        if (nameIndex < 0 && valueIndex >= 0 && table.columns.length === 2) nameIndex = valueIndex === 0 ? 1 : 0;
        if (nameIndex < 0 || valueIndex < 0 || nameIndex === valueIndex) return [];
        let invalidRows = 0;
        let numeric = false;
        const records = table.rows.map(row => {
            const text = String(row[valueIndex] ?? '').trim();
            const value = unit === undefined ? parseGrafanaTableDisplayValue(text)
                : unitParser.parseDisplayValue(text, unit);
            const name = String(row[nameIndex] || '').trim();
            if (value !== null || /^[-+−–]?(?:\d|[.,]\d)/u.test(text)) numeric = true;
            if (!name || value === null) invalidRows += 1;
            return { name, visible: true, values: [value].filter(Number.isFinite) };
        }).filter(record => record.name && record.values.length);
        // Preserve the public records array; completeness belongs to this DOM snapshot.
        table.numericParse = { complete: invalidRows === 0, numeric, invalidRows };
        return records;
    };

    globalThis.DashBridgeGrafanaTableReport = Object.freeze({
        parseGrafanaTableDisplayValue,
        getResponseTableFrameShape,
        collectGrafanaTableData,
        collectGrafanaTableRecords
    });
})(globalThis);
