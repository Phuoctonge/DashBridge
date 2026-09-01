'use strict';

(function initTestDiagnosticViewer(root) {
function create({ report, createChunkedJsonBlob, copyTextToClipboard, setStatus, esc, formatDuration }) {
    if (!report?.buildVisualAudit || typeof createChunkedJsonBlob !== 'function'
        || typeof copyTextToClipboard !== 'function' || typeof setStatus !== 'function'
        || typeof esc !== 'function' || typeof formatDuration !== 'function') {
        throw new Error('DashBridgeTestDiagnosticViewer requires report, serialization, clipboard, status, and formatting dependencies');
    }

function showTestDescription(test) {
    const popup = window.open('', `dashbridge-test-info-${test.id}`, 'popup=yes,width=680,height=620,resizable=yes,scrollbars=yes');
    if (!popup) return;
    popup.document.open();
    popup.document.write('<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Описание E2E-теста</title></head><body></body></html>');
    popup.document.close();
    const style = popup.document.createElement('style');
    style.textContent = 'body{margin:0;padding:28px;background:#0f172a;color:#e2e8f0;font:14px/1.55 Inter,system-ui,sans-serif}main{max-width:760px;margin:auto}h1{font-size:24px;margin:0 0 8px}.id{color:#93c5fd;font:13px Consolas,monospace}.card{margin-top:18px;padding:16px;border:1px solid #475569;border-radius:10px;background:#1e293b}h2{font-size:16px;margin:0 0 8px}ol{padding-left:22px}code{color:#93c5fd}';
    popup.document.head.appendChild(style);
    const main = popup.document.createElement('main');
    const title = popup.document.createElement('h1');
    title.textContent = test.feature?.label || test.name;
    const id = popup.document.createElement('div');
    id.className = 'id';
    id.textContent = `${test.id}${test.feature?.technicalName ? ` · ${test.feature.technicalName}` : ''}`;
    const description = popup.document.createElement('section');
    description.className = 'card';
    const descriptionTitle = popup.document.createElement('h2');
    descriptionTitle.textContent = 'Что проверяет';
    const descriptionText = popup.document.createElement('p');
    descriptionText.textContent = test.feature?.description || 'Причинная E2E-проверка DashBridge.';
    description.append(descriptionTitle, descriptionText);
    main.append(title, id, description);
    const steps = test.feature?.steps || [];
    if (steps.length) {
        const section = popup.document.createElement('section');
        section.className = 'card';
        const heading = popup.document.createElement('h2');
        heading.textContent = 'Последовательность действий';
        const list = popup.document.createElement('ol');
        steps.forEach(step => {
            const item = popup.document.createElement('li');
            item.textContent = step.replace(/^\d+\.\s*/, '');
            list.appendChild(item);
        });
        section.append(heading, list);
        main.appendChild(section);
    }
    if (test.feature?.sourceFile) {
        const source = popup.document.createElement('section');
        source.className = 'card';
        const heading = popup.document.createElement('h2');
        heading.textContent = 'Проверяемый код';
        const code = popup.document.createElement('code');
        code.textContent = `${test.feature.sourceFile}${test.feature.sourceSymbol ? ` · ${test.feature.sourceSymbol}` : ''}`;
        source.append(heading, code);
        main.appendChild(source);
    }
    popup.document.body.appendChild(main);
    popup.focus();
}

function showDiagnostic(test, urlResult) {
    const visualAudit = report.buildVisualAudit(test);
    const payload = {
        schema: 'dashbridge-e2e-diagnostic-view/v1',
        url: urlResult.url,
        engine: urlResult.engine,
        grafanaVersion: urlResult.grafanaVersion,
        test: {
            id: test.id,
            name: test.name,
            feature: test.feature || null,
            pass: test.pass,
            skip: test.skip,
            aborted: !!test.aborted,
            details: test.details,
            durationMs: test.durationMs,
            visualAudit,
            diagnostic: test.diagnostic,
        },
    };
    // noopener makes window.open() return null in Chromium, so the old code
    // always treated an already opened tab as blocked and left it at about:blank.
    const popup = window.open('', '_blank', 'width=1280,height=860');
    if (!popup) {
        const compactNotice = JSON.stringify({
            schema: payload.schema,
            url: payload.url,
            test: { id: test.id, name: test.name, details: test.details },
            notice: 'Полный объект слишком велик для буфера обмена; используйте экспорт JSON.',
        }, null, 2);
        void copyTextToClipboard(compactNotice, null);
        setStatus('Диагностика скопирована в буфер: браузер заблокировал окно просмотра', 'tr-status tr-status-warn');
        return;
    }

    const imagePool = new Map();
    const collectImages = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) { obj.forEach(collectImages); return; }
        if (obj.hash && obj.dataUrl) imagePool.set(obj.hash, obj.dataUrl);
        Object.values(obj).forEach(collectImages);
    };
    collectImages(payload);

    const addSnapshot = (host, title, snapshot, seenVisuals = null) => {
        const unique = (kind, image) => {
            if (!image?.dataUrl) return false;
            const key = `${kind}:${image.hash || image.dataUrl}`;
            if (seenVisuals?.has(key)) return false;
            seenVisuals?.add(key);
            return true;
        };
        const viewportImage = unique('viewport', snapshot?.viewportImage) ? snapshot.viewportImage : null;
        const panelImage = unique('panel', snapshot?.panelImage) ? snapshot.panelImage : null;
        const canvas = (snapshot?.canvas || []).filter(item => unique('canvas', item));
        if (!canvas.length && !panelImage && !viewportImage) return;
        const section = popup.document.createElement('section');
        section.className = 'snapshot';
        const heading = popup.document.createElement('h2');
        heading.textContent = title;
        section.appendChild(heading);

        const state = popup.document.createElement('div');
        state.className = 'snapshot-state';
        const markers = snapshot?.markers || {};
        const markerText = [
            markers.legendBottom ? 'легенда снизу' : '',
            markers.hidden ? `скрыто: ${markers.hidden}` : '',
            markers.dimmed ? `затемнено: ${markers.dimmed}` : '',
            markers.threshold ? `порог: ${markers.threshold}` : '',
        ].filter(Boolean);
        const series = (snapshot?.series || []).map(item => item.label).filter(Boolean);
        state.textContent = [
            snapshot?.renderer ? `Рендерер: ${snapshot.renderer}` : '',
            Number.isFinite(snapshot?.chartSeriesCount) ? `серий: ${snapshot.chartSeriesCount}` : '',
            markerText.join(' · '),
            series.length ? `ряды: ${series.slice(0, 8).join(', ')}${series.length > 8 ? '…' : ''}` : '',
            snapshot?.legend?.entries ? `легенда: ${snapshot.legend.bottomEntries}/${snapshot.legend.entries} строк в нижнем контейнере` : '',
        ].filter(Boolean).join('  | ');
        if (state.textContent) section.appendChild(state);

        if (snapshot?.logs && snapshot.logs.length > 0) {
            const logsBlock = popup.document.createElement('pre');
            logsBlock.className = 'snapshot-logs';
            logsBlock.textContent = snapshot.logs.join('\n');
            section.appendChild(logsBlock);
        }

        const images = popup.document.createElement('div');
        images.className = 'images';
        if (viewportImage?.dataUrl) {
            const figure = popup.document.createElement('figure');
            const image = popup.document.createElement('img');
            image.src = viewportImage.dataUrl;
            image.alt = `${title}, весь видимый экран вкладки`;
            image.title = 'Нажмите, чтобы открыть оригинал PNG в новой вкладке';
            image.addEventListener('click', () => window.open(viewportImage.dataUrl, '_blank', 'noopener,noreferrer'));
            const caption = popup.document.createElement('figcaption');
            caption.textContent = `Вся видимая вкладка · ${viewportImage.width}×${viewportImage.height} · ${viewportImage.hash}`;
            figure.append(image, caption);
            images.appendChild(figure);
        }
        if (panelImage?.dataUrl) {
            const figure = popup.document.createElement('figure');
            const image = popup.document.createElement('img');
            image.src = panelImage.dataUrl;
            image.alt = `${title}, панель вместе с легендой`;
            image.title = 'Нажмите, чтобы открыть оригинал PNG в новой вкладке';
            image.addEventListener('click', () => window.open(panelImage.dataUrl, '_blank', 'noopener,noreferrer'));
            const caption = popup.document.createElement('figcaption');
            caption.textContent = `Панель целиком (график + HTML-легенда) · ${panelImage.width}×${panelImage.height}`;
            figure.append(image, caption);
            images.appendChild(figure);
        }
        canvas.forEach((item, index) => {
            const figure = popup.document.createElement('figure');
            const caption = popup.document.createElement('figcaption');
            caption.textContent = `Canvas ${index + 1} · ${item.width}×${item.height} · ${item.hash} · ${item.bytes} B`;
            const url = item.dataUrl || imagePool.get(item.hash);
            if (url) {
                const image = popup.document.createElement('img');
                image.src = url;
                image.alt = `${title}, canvas ${index + 1}`;
                image.title = 'Нажмите, чтобы открыть оригинал PNG в новой вкладке';
                image.addEventListener('click', () => window.open(url, '_blank', 'noopener,noreferrer'));
                figure.appendChild(image);
            } else {
                const unavailable = popup.document.createElement('div');
                unavailable.className = 'unavailable';
                unavailable.textContent = 'Изображение отсутствует: этот отчёт создан до включения захвата PNG.';
                figure.appendChild(unavailable);
            }
            figure.appendChild(caption);
            images.appendChild(figure);
        });
        section.appendChild(images);
        host.appendChild(section);
    };

    const popupTheme = document.documentElement.getAttribute('data-theme') || 'light';
    try { popup.opener = null; } catch (_) { }
    popup.document.open();
    popup.document.write(`<!doctype html><html lang="ru" data-theme="${esc(popupTheme)}"><head><meta charset="utf-8"><title>Диагностика ${esc(test.id)}</title><style>
      :root{color-scheme:light;--primary:#2563eb;--success:#15803d;--danger:#ef4444;--warning:#f59e0b;--bg:#f1f5f9;--card:#fff;--surface:#f8fafc;--text:#0f172a;--muted:#64748b;--border:#cbd5e1;--shadow:0 4px 6px -1px rgba(0,0,0,.08)}
      [data-theme="dark"]{color-scheme:dark;--primary:#60a5fa;--success:#4ade80;--danger:#f87171;--warning:#fbbf24;--bg:#0f172a;--card:#1e293b;--surface:#334155;--text:#f1f5f9;--muted:#cbd5e1;--border:#475569;--shadow:0 4px 6px -1px rgba(0,0,0,.35)}
      *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 Inter,-apple-system,system-ui,sans-serif}.page{max-width:1180px;margin:0 auto;padding:28px 32px 48px}h1{margin:0;font-size:28px;line-height:1.2;letter-spacing:-.02em}h2{margin:0 0 10px;font-size:18px}header{border-bottom:1px solid var(--border);padding-bottom:20px;margin-bottom:24px}.meta{color:var(--primary);margin:8px 0 16px}.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px}.fact{padding:10px 12px;background:var(--card);border:1px solid var(--border);border-radius:8px;box-shadow:var(--shadow)}.fact b{display:block;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.04em}.fact span{display:block;margin-top:3px;font-weight:650}.pass{color:var(--success)}.fail{color:var(--danger)}.skip{color:var(--warning)}.result{margin:16px 0 0;padding:12px 14px;border-left:3px solid var(--primary);background:var(--card);border-radius:0 8px 8px 0;white-space:pre-wrap}.snapshot{margin:26px 0;padding-top:2px}.snapshot-state{margin:-3px 0 10px;color:var(--muted);font:12px/1.45 Consolas,monospace;overflow-wrap:anywhere}.snapshot-logs{margin:10px 0;padding:10px;border:1px solid color-mix(in srgb,var(--success) 35%,var(--border));border-left:3px solid var(--success);border-radius:6px;background:#071b13;color:#86efac;font:12px/1.45 Consolas,monospace;overflow-x:auto;white-space:pre-wrap}.images{display:grid;grid-template-columns:1fr;gap:16px}figure{margin:0;border:1px solid var(--border);border-radius:10px;padding:10px;background:var(--card);box-shadow:var(--shadow);min-width:0}img{display:block;width:100%;height:auto;background:#fff;cursor:zoom-in;border-radius:5px}figcaption{margin-top:8px;color:var(--muted);font:12px/1.4 Consolas,monospace}.unavailable{padding:16px;background:var(--surface);color:var(--warning);border-radius:6px}details{margin-top:28px;border-top:1px solid var(--border);padding-top:16px}summary{cursor:pointer;color:var(--primary);font-weight:650}pre{margin:12px 0 0;white-space:pre-wrap;word-break:break-word;color:var(--text);font:12px/1.45 Consolas,monospace}@media(max-width:600px){.page{padding:20px 16px}h1{font-size:23px}}</style></head><body><main class="page"></main></body></html>`);
    popup.document.close();
    const syncPopupTheme = event => {
        if (popup.closed) return;
        popup.document.documentElement.setAttribute('data-theme', event.detail?.theme || document.documentElement.getAttribute('data-theme') || 'light');
    };
    window.addEventListener('dashbridge-theme-change', syncPopupTheme);
    popup.addEventListener('unload', () => window.removeEventListener('dashbridge-theme-change', syncPopupTheme), { once: true });
    const body = popup.document.querySelector('.page');
    const header = popup.document.createElement('header');
    const heading = popup.document.createElement('h1');
    heading.textContent = `Диагностика ${test.id}: ${test.feature?.label || test.name}`;
    header.appendChild(heading);
    const meta = popup.document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${urlResult.engine || '—'} · Grafana ${urlResult.grafanaVersion || '—'}`;
    header.appendChild(meta);
    const facts = popup.document.createElement('div');
    facts.className = 'facts';
    const status = test.aborted ? 'NOT RUN' : (test.skip ? 'SKIP' : (test.pass ? 'PASS' : 'FAIL'));
    const verdict = test.diagnostic?.verdict || {};
    const runtime = verdict.runtime || {};
    const transitionFacts = (test.diagnostic?.transitions || []).map(step => {
        const outcome = step.verdict?.outcome || (step.invariant?.skip ? 'skip' : (step.invariant?.pass ? 'pass' : 'fail'));
        const persistence = step.persistence || step.command?.persistence;
        const persistenceFact = persistence?.required
            ? ` | persistence=${persistence.passed ? 'PROVEN' : 'FAILED'} (${persistence.reason || 'без причины'})`
            : '';
        return `${step.index || '—'}: ${outcome.toUpperCase()} — ${step.verdict?.reason || step.invariant?.reason || step.label}${persistenceFact}`;
    });
    const factValues = [
        ['Результат', status, status.toLowerCase()],
        ['Функциональная проверка', verdict.functionalPass === false ? 'FAIL' : (verdict.functionalPass === true ? 'PASS' : '—'), verdict.functionalPass === false ? 'fail' : (verdict.functionalPass === true ? 'pass' : '')],
        ['Ошибки DashBridge', String(runtime.dashBridgeErrorCount ?? 0), runtime.dashBridgeErrorCount ? 'fail' : 'pass'],
        ['Предупреждения Grafana', String(runtime.grafanaWarningCount ?? 0), runtime.grafanaWarningCount ? 'skip' : ''],
        ['console.warn', String(runtime.warningCount ?? 0), runtime.warningCount ? 'skip' : ''],
        ['Длительность', formatDuration(test.durationMs || 0), ''],
        ['Панель', test.diagnostic?.before?.panelId || test.diagnostic?.baseline?.panelId || '—', ''],
        ['Рендерер', test.diagnostic?.before?.renderer || test.diagnostic?.baseline?.renderer || urlResult.engine || '—', ''],
        ...(test.feature?.sourceFile ? [['Исходный код', `${test.feature.sourceFile}${test.feature.sourceSymbol ? ` · ${test.feature.sourceSymbol}` : ''}`, '']] : []),
    ];
    factValues.forEach(([label, value, className]) => {
        const fact = popup.document.createElement('div');
        fact.className = 'fact';
        fact.innerHTML = `<b>${esc(label)}</b><span class="${className}">${esc(value)}</span>`;
        facts.appendChild(fact);
    });
    header.appendChild(facts);
    if (test.feature?.description) {
        const featureDescription = popup.document.createElement('div');
        featureDescription.className = 'result';
        featureDescription.textContent = test.feature.description;
        header.appendChild(featureDescription);
    }
    if (test.details) {
        const result = popup.document.createElement('div');
        result.className = 'result';
        result.textContent = test.details;
        header.appendChild(result);
    }
    body.appendChild(header);
    if (visualAudit.transitions.length) {
        const visualSummary = popup.document.createElement('div');
        visualSummary.className = 'result';
        visualSummary.textContent = [
            `Visual audit: ${visualAudit.complete ? 'все обязательные доказательства собраны' : 'набор доказательств неполный'}`,
            ...visualAudit.transitions.map(transition => {
                const features = transition.activeFeatures.length ? transition.activeFeatures.join(' + ') : 'all-off';
                const pixel = transition.pixelDelta
                    ? `; histogram Δ=${transition.pixelDelta.histogramDistance}; luminance Δ=${transition.pixelDelta.luminanceMeanDelta}` : '';
                return `Шаг ${transition.index} [${features}]: imageChanged=${transition.imageChanged}; semanticChanged=${transition.semanticChanged}${pixel}; issues=${transition.issues.join(', ') || 'нет'}`;
            }),
        ].join('\n');
        body.appendChild(visualSummary);
    }
    if (visualAudit.issues.length || !visualAudit.complete) {
        const visualWarning = popup.document.createElement('div');
        visualWarning.className = 'result skip';
        visualWarning.textContent = [
            `Автоматический visual audit: ${visualAudit.suspicious ? 'ПОДОЗРИТЕЛЬНЫЙ PASS' : 'есть замечания'}`,
            visualAudit.missingPhases.length ? `Нет обязательных доказательств: ${visualAudit.missingPhases.join(', ')}` : '',
            ...visualAudit.issues.map(issue => `${issue.transition ? `Шаг ${issue.transition}: ` : ''}${issue.code}${issue.phase ? ` (${issue.phase})` : ''}`),
        ].filter(Boolean).join('\n');
        body.appendChild(visualWarning);
    }
    if (transitionFacts.length) {
        const transitionResult = popup.document.createElement('div');
        transitionResult.className = 'result';
        transitionResult.textContent = `Доказательства переходов:\n${transitionFacts.join('\n')}`;
        body.appendChild(transitionResult);
    }
    const actionTimeline = test.diagnostic?.actionTimeline || [];
    if (actionTimeline.length) {
        const actionResult = popup.document.createElement('div');
        actionResult.className = 'result';
        actionResult.textContent = `Журнал действий (${actionTimeline.length}):\n${actionTimeline.map(action => {
            const checkpoints = action.checkpoints?.filter(item => item.at).length || 0;
            const changes = (action.diffs || []).reduce((sum, diff) => sum + (diff.changeCount || 0), 0);
            const status = action.output?.status || (action.output?.pass === true ? 'pass' : 'observed');
            return `${action.sequence}. ${action.description || action.action} — ${status}; ${action.durationMs ?? '—'} мс; checkpoints=${checkpoints}; changedPaths=${changes}`;
        }).join('\n')}`;
        body.appendChild(actionResult);
    }
    const grafanaWarnings = runtime.grafanaWarnings || [];
    if (grafanaWarnings.length) {
        const warningResult = popup.document.createElement('div');
        warningResult.className = 'result skip';
        warningResult.textContent = `Предупреждения Grafana (не влияют на PASS/FAIL):\n${grafanaWarnings.map(event => (event.args || []).join(' ')).join('\n')}`;
        body.appendChild(warningResult);
    }
    const seenVisuals = new Set();
    const visualGalleryNote = popup.document.createElement('div');
    visualGalleryNote.className = 'result';
    visualGalleryNote.textContent = 'Уникальные визуальные доказательства: одинаковые viewport, panel и canvas повторно не показываются. Полный технический timeline остаётся в JSON.';
    body.appendChild(visualGalleryNote);
    const addUniqueSnapshot = (title, snapshot) => addSnapshot(body, title, snapshot, seenVisuals);
    addUniqueSnapshot('Страница при открытии сценария', test.diagnostic?.opened);
    addUniqueSnapshot('Внешний снимок: до запуска сценария', test.diagnostic?.before);
    if (test.diagnostic?.baseline) {
        addUniqueSnapshot('Базовое состояние сценария', test.diagnostic.baseline);
    }
    (test.diagnostic?.transitions || []).forEach(step => {
        const number = step.index ? `Шаг ${step.index}` : 'Шаг';
        addUniqueSnapshot(`${number}: ${step.label} — непосредственно до команды`, step.before);
        addUniqueSnapshot(`${number}: ${step.label} — после команды, до Refresh`, step.command?.afterCommandBeforeRefresh);
        const persistence = step.persistence || step.command?.persistence;
        if (persistence?.required) {
            addUniqueSnapshot(`${number}: ${step.label} — после первого refresh`, persistence.beforeRefresh);
            addUniqueSnapshot(`${number}: ${step.label} — после второго refresh без повторной команды`, step.after);
        } else {
            addUniqueSnapshot(`${number}: ${step.label} — состояние после команды и refresh`, step.after);
        }
    });
    addUniqueSnapshot('Внешний снимок: после завершения сценария', test.diagnostic?.after);
    addUniqueSnapshot('После команды гарантированного сброса, до Refresh', test.diagnostic?.reset?.command?.afterCommandBeforeRefresh);
    addUniqueSnapshot('После гарантированного сброса', test.diagnostic?.reset?.after);
    const details = popup.document.createElement('details');
    const summary = popup.document.createElement('summary');
    summary.textContent = 'Полная JSON-диагностика теста';
    const rawHint = popup.document.createElement('p');
    rawHint.textContent = 'Диагностика может быть слишком большой для отображения как один текстовый DOM-узел.';
    const rawDownload = popup.document.createElement('button');
    rawDownload.textContent = 'Скачать JSON этого теста';
    rawDownload.addEventListener('click', async () => {
        rawDownload.disabled = true;
        rawDownload.textContent = 'Сборка JSON частями…';
        try {
            const blob = await createChunkedJsonBlob(payload, progress => {
                rawDownload.textContent = `Сборка: ${(progress.characters / 1024 / 1024).toFixed(1)} МБ`;
            });
            const rawUrl = URL.createObjectURL(blob);
            const link = popup.document.createElement('a');
            link.href = rawUrl;
            link.download = `dashbridge-${test.id}-diagnostic.json`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(rawUrl), 60_000);
            rawDownload.textContent = `Скачивание начато: ${(blob.size / 1024 / 1024).toFixed(1)} МБ`;
        } catch (error) {
            rawDownload.textContent = `Ошибка: ${error?.message || String(error)}`;
        } finally {
            rawDownload.disabled = false;
        }
    });
    details.append(summary, rawHint, rawDownload);
    body.appendChild(details);
    popup.focus();
}

    return Object.freeze({ showDiagnostic, showTestDescription });
}

root.DashBridgeTestDiagnosticViewer = Object.freeze({ create });
})(globalThis);
