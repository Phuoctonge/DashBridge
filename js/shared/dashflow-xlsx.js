(function (root) {
    'use strict';

    const MAX_CELL_TEXT = 32_767;

    function xml(value) {
        return String(value ?? '').replace(/[&<>"']/g, character => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
        })[character]);
    }

    function columnName(index) {
        let value = index + 1; let result = '';
        while (value > 0) {
            value -= 1; result = String.fromCharCode(65 + value % 26) + result; value = Math.floor(value / 26);
        }
        return result;
    }

    function textCell(row, column, value, style = 0) {
        const reference = `${columnName(column)}${row}`;
        const text = String(value ?? '').slice(0, MAX_CELL_TEXT);
        return `<c r="${reference}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xml(text)}</t></is></c>`;
    }

    function numberCell(row, column, value, style = 0) {
        const reference = `${columnName(column)}${row}`;
        return `<c r="${reference}" s="${style}"><v>${Number(value) || 0}</v></c>`;
    }

    function formulaCell(row, column, formula, cachedValue, style = 4) {
        const reference = `${columnName(column)}${row}`;
        return `<c r="${reference}" s="${style}"><f>${xml(formula)}</f><v>${Number(cachedValue) || 0}</v></c>`;
    }

    function rowXml(row, cells, height) {
        return `<row r="${row}"${height ? ` ht="${height}" customHeight="1"` : ''}>${cells.join('')}</row>`;
    }

    function resultStyle(status) {
        return ({ unchanged: 5, changed: 6, added: 7, removed: 8 })[status] || 0;
    }

    function statusLabel(status) {
        return ({ unchanged: 'Без изменений', changed: 'Изменено', added: 'Добавлено', removed: 'Удалено' })[status] || status || '—';
    }

    function worksheet({ columns, rows, merge, autoFilter, freezeRows = 0 }) {
        const pane = freezeRows
            ? `<pane ySplit="${freezeRows}" topLeftCell="A${freezeRows + 1}" activePane="bottomLeft" state="frozen"/>`
            : '';
        const cols = columns.map((config, index) => {
            const width = typeof config === 'object' ? config.width : config;
            const hidden = typeof config === 'object' && config.hidden ? ' hidden="1"' : '';
            return `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"${hidden}/>`;
        }).join('');
        const merges = Array.isArray(merge) ? merge : (merge ? [merge] : []);
        return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0" showGridLines="0">${pane}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${rows.join('')}</sheetData>
${autoFilter ? `<autoFilter ref="${autoFilter}"/>` : ''}
${merges.length ? `<mergeCells count="${merges.length}">${merges.map(reference => `<mergeCell ref="${reference}"/>`).join('')}</mergeCells>` : ''}
<pageMargins left="0.4" right="0.4" top="0.6" bottom="0.6" header="0.2" footer="0.2"/>
</worksheet>`;
    }

    function summarySheet(report, items) {
        const rows = [];
        rows.push(rowXml(1, [textCell(1, 0, 'DashBridge — сравнение baseline и replay', 1)], 28));
        rows.push(rowXml(3, [textCell(3, 0, 'Сценарий', 3), textCell(3, 1, report.title || 'DashBridge recording')]));
        rows.push(rowXml(4, [textCell(4, 0, 'Сформирован', 3), textCell(4, 1, report.generatedDisplay || report.generatedAt)]));
        rows.push(rowXml(5, [textCell(5, 0, 'Фильтр URL', 3), textCell(5, 1, report.urlFilter || report.domainFilter || 'Все URL')]));
        rows.push(rowXml(6, [textCell(6, 0, 'Фильтр результата', 3), textCell(6, 1, report.statusFilter === 'all' ? 'Все результаты' : statusLabel(report.statusFilter))]));
        const detailLastRow = Math.max(4, items.length + 3);
        const statusCells = []; const countCells = [];
        ['unchanged', 'changed', 'added', 'removed'].forEach((status, index) => {
            const column = index * 2; const count = items.filter(item => item.status === status).length;
            statusCells.push(textCell(8, column, statusLabel(status), resultStyle(status)));
            countCells.push(formulaCell(9, column, `COUNTIF('Различия'!$C$4:$C$${detailLastRow},"${statusLabel(status)}")`, count, 10));
        });
        rows.push(rowXml(8, statusCells, 22));
        rows.push(rowXml(9, countCells, 30));
        rows.push(rowXml(12, ['Шаг', 'Действие', 'Переход', 'Без изменений', 'Изменено', 'Добавлено', 'Удалено', 'Всего']
            .map((value, column) => textCell(12, column, value, 2)), 24));
        const grouped = new Map();
        for (const item of items) {
            const stepId = Number(item.stepId) || 0;
            if (!grouped.has(stepId)) grouped.set(stepId, []);
            grouped.get(stepId).push(item);
        }
        [...grouped].sort(([left], [right]) => left - right).forEach(([stepId, stepItems], index) => {
            const row = 13 + index; const step = report.steps.find(candidate => candidate.id === stepId) || {};
            const rangeEnd = detailLastRow;
            const cells = [
                numberCell(row, 0, stepId, 11), textCell(row, 1, step.action || 'Без шага', 9),
                textCell(row, 2, step.navigationUrl || '', 9),
            ];
            ['unchanged', 'changed', 'added', 'removed'].forEach((status, statusIndex) => {
                const count = stepItems.filter(item => item.status === status).length;
                cells.push(formulaCell(row, 3 + statusIndex,
                    `COUNTIFS('Различия'!$A$4:$A$${rangeEnd},A${row},'Различия'!$C$4:$C$${rangeEnd},"${statusLabel(status)}")`, count));
            });
            cells.push(formulaCell(row, 7, `SUM(D${row}:G${row})`, stepItems.length));
            rows.push(rowXml(row, cells, 34));
        });
        return worksheet({
            columns: [18, 36, 42, 17, 14, 14, 14, 11], rows,
            merge: ['A1:H1', 'B3:H3', 'B4:H4', 'B5:H5', 'B6:H6', 'A8:B8', 'C8:D8', 'E8:F8', 'G8:H8', 'A9:B9', 'C9:D9', 'E9:F9', 'G9:H9'],
            freezeRows: 12,
        });
    }

    function detailsSheet(report, items) {
        const rows = [rowXml(1, [textCell(1, 0, 'Различия по шагам', 1)], 28)];
        const headers = ['Шаг', 'Действие', 'Результат', 'Метод', 'URL', 'Baseline status', 'Replay status', 'Baseline MIME', 'Replay MIME', 'Различия'];
        rows.push(rowXml(3, headers.map((header, column) => textCell(3, column, header, 2)), 28));
        items.forEach((item, index) => {
            const row = index + 4; const stepId = Number(item.stepId) || 0;
            const step = report.steps.find(candidate => candidate.id === stepId) || {};
            const action = `${step.action || 'Без шага'}${step.navigationUrl ? ` → navigate ${step.navigationUrl}` : ''}`;
            const values = [
                stepId, action, statusLabel(item.status), item.method || '', item.url || '',
                item.baseline?.status ?? '', item.current?.status ?? '', item.baseline?.mimeType || '', item.current?.mimeType || '',
                (item.differences || []).join(', '),
            ];
            rows.push(rowXml(row, values.map((value, column) => column === 0
                ? numberCell(row, column, value, 11)
                : textCell(row, column, value, column === 2 ? resultStyle(item.status) : 0)), 20));
        });
        const lastRow = Math.max(3, items.length + 3);
        return worksheet({
            columns: [8, 32, 16, 10, 54, 15, 15, 20, 20, 20],
            rows, merge: 'A1:J1', autoFilter: `A3:J${lastRow}`, freezeRows: 3,
        });
    }

    function technicalSheet(report, items) {
        const rows = [rowXml(1, [textCell(1, 0, 'Технические данные сравнения', 1)], 28)];
        const headers = ['Шаг', 'Метод', 'URL', 'Baseline SHA-256', 'Replay SHA-256'];
        rows.push(rowXml(3, headers.map((header, column) => textCell(3, column, header, 2)), 28));
        items.forEach((item, index) => {
            const row = index + 4;
            const values = [Number(item.stepId) || 0, item.method || '', item.url || '', item.baseline?.bodySha256 || '', item.current?.bodySha256 || ''];
            rows.push(rowXml(row, values.map((value, column) => column === 0 ? numberCell(row, column, value, 11) : textCell(row, column, value)), 20));
        });
        const lastRow = Math.max(3, items.length + 3);
        return worksheet({ columns: [8, 10, 58, 68, 68], rows, merge: 'A1:E1', autoFilter: `A3:E${lastRow}`, freezeRows: 3 });
    }

    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="16"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="18"/><color rgb="FF1E3A8A"/><name val="Calibri"/></font></fonts>
<fills count="8"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2563EB"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1E3A8A"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDCFCE7"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFEF3C7"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE0F2FE"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFEE2E2"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="12"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyFont="1"><alignment horizontal="left"/></xf><xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="0" fillId="4" borderId="0" xfId="0" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="5" borderId="0" xfId="0" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="6" borderId="0" xfId="0" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="7" borderId="0" xfId="0" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="1" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

    async function build(report) {
        if (typeof JSZip !== 'function') throw new Error('JSZip не загружен');
        const items = Array.isArray(report?.items) ? report.items : [];
        const zip = new JSZip();
        zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`);
        zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`);
        zip.file('docProps/app.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>DashBridge</Application></Properties>`);
        zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"><dc:creator>DashBridge</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${xml(report.generatedAt)}</dcterms:created></cp:coreProperties>`);
        zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets><sheet name="Итоги" sheetId="1" r:id="rId1"/><sheet name="Различия" sheetId="2" r:id="rId2"/><sheet name="Технические данные" sheetId="3" r:id="rId3"/></sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`);
        zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
        zip.file('xl/styles.xml', styles);
        zip.file('xl/worksheets/sheet1.xml', summarySheet(report, items));
        zip.file('xl/worksheets/sheet2.xml', detailsSheet(report, items));
        zip.file('xl/worksheets/sheet3.xml', technicalSheet(report, items));
        return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    }

    root.DashBridgeComparisonXlsx = Object.freeze({ build });
})(globalThis);
