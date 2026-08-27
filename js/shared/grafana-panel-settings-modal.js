// Shared panel-settings UI. Hosts provide data sources and persistence.
(() => {
    if (window.DashBridgePanelSettingsModal) return;

    const getInterfaceScale = () => {
        const root = document.documentElement;
        const requestedScale = Number.parseFloat(root?.dataset?.uiScale);
        if (Number.isFinite(requestedScale)) return Math.min(1.5, Math.max(0.9, requestedScale / 100));
        const rootFontSize = Number.parseFloat(globalThis.getComputedStyle?.(root)?.fontSize);
        if (root?.dataset?.uiScale === 'auto' && Number.isFinite(rootFontSize)) {
            return Math.min(1.5, Math.max(0.9, rootFontSize / 16));
        }
        // Native Grafana already follows browser zoom and owns its responsive
        // geometry. Only DashBridge pages expose data-ui-scale; on every other
        // host keep our injected modal at the host's normal CSS scale.
        return 1;
    };

    const ensureStyles = () => {
        if (document.getElementById('dashbridge-panel-settings-shared-style')) return;
        const style = document.createElement('style');
        style.id = 'dashbridge-panel-settings-shared-style';
        style.textContent = `
            .dashbridge-panel-settings-overlay { position:fixed; inset:0; z-index:2147483647; display:flex; align-items:center; justify-content:center; background:rgba(15,23,42,.58); font:13px system-ui; }
            .dashbridge-panel-settings { --card-bg:#fff; --bg-color:#f8fafc; --bg-elevated:#fff; --text-main:#182033; --text-muted:#667085; --border-color:#cbd5e1; --primary:#4361e8; --primary-hover:#3452cf; --radius-md:6px; width:min(460px,calc(100vw - 32px)); max-height:calc(100vh - 32px); min-height:0; display:flex; flex-direction:column; overflow:hidden; padding:20px; border:1px solid var(--border-color); border-radius:8px; background:var(--bg-color); color:var(--text-main); box-shadow:0 20px 25px -5px rgba(0,0,0,.2); }
            .dashbridge-panel-settings-overlay.dashbridge-panel-settings-dark .dashbridge-panel-settings { --card-bg:#1e293b; --bg-color:#0f172a; --bg-elevated:#1e293b; --text-main:#f1f5f9; --text-muted:#cbd5e1; --border-color:#475569; --primary:#60a5fa; --primary-hover:#3b82f6; }
            .dashbridge-panel-settings,.dashbridge-panel-settings * { box-sizing:border-box; }.dashbridge-panel-settings h3 { margin:0; color:var(--text-main); font:700 18px/1.3 system-ui; }.dashbridge-panel-settings > .panel-tools-scroll { flex:1 1 auto; min-height:0; overflow-y:auto; padding-right:16px; scrollbar-gutter:stable; }.panel-tools-footer { flex:0 0 auto; display:flex; gap:8px; margin-top:18px; padding-top:14px; border-top:1px solid var(--border-color); }.panel-tools-footer button { min-height:40px; flex:1; padding:8px 12px; border-radius:6px; border:1px solid var(--border-color); background:transparent; color:inherit; font:600 14px/1.2 system-ui; cursor:pointer; }.panel-tools-footer button:hover { border-color:var(--primary); color:var(--primary); }.dashbridge-panel-settings .save { background:var(--primary); color:#fff; border-color:var(--primary); }.dashbridge-panel-settings .save:hover { background:var(--primary-hover); color:#fff; }
            .dashbridge-panel-settings .btn,.panel-tools-modal .btn { display:inline-flex; align-items:center; justify-content:center; gap:8px; padding:8px 16px; border:1px solid var(--border-color,#cbd5e1); border-radius:6px; background:var(--card-bg,#f8fafc); color:var(--text-main,#182033); font:500 14px/1.2 system-ui; cursor:pointer; transition:background .2s,color .2s,border-color .2s; }.dashbridge-panel-settings .btn-primary,.panel-tools-modal .btn-primary { background:var(--primary,#4361e8); color:#fff; border-color:var(--primary,#4361e8); }.dashbridge-panel-settings .btn-outline,.panel-tools-modal .btn-outline { background:transparent; }.dashbridge-panel-settings .btn:hover,.panel-tools-modal .btn:hover { border-color:var(--primary,#4361e8); color:var(--primary,#4361e8); }.dashbridge-panel-settings .btn-primary:hover,.panel-tools-modal .btn-primary:hover { color:#fff; background:var(--primary-hover,#3452cf); }
            .dashbridge-panel-settings .switch,.panel-tools-modal .switch { position:relative; display:inline-block; width:38px; height:22px; }.dashbridge-panel-settings .switch input,.panel-tools-modal .switch input { width:0; height:0; opacity:0; }.dashbridge-panel-settings .slider,.panel-tools-modal .slider { position:absolute; inset:0; border-radius:999px; background:#cbd5e1; transition:.2s; cursor:pointer; }.dashbridge-panel-settings .slider::before,.panel-tools-modal .slider::before { content:''; position:absolute; width:14px; height:14px; left:4px; bottom:4px; border-radius:50%; background:#fff; transition:.2s; }.dashbridge-panel-settings .switch input:checked + .slider,.panel-tools-modal .switch input:checked + .slider { background:var(--primary,#4361e8); }.dashbridge-panel-settings .switch input:checked + .slider::before,.panel-tools-modal .switch input:checked + .slider::before { transform:translateX(16px); }.dashbridge-panel-settings .switch input:disabled + .slider,.panel-tools-modal .switch input:disabled + .slider { background:#cbd5e1 !important; opacity:.72; cursor:not-allowed; }
            .panel-tools-modal { max-width:520px; max-height:calc(100vh - 32px); display:flex; flex-direction:column; overflow:hidden; }.panel-tools-scroll { min-height:0; overflow-y:auto; padding-right:16px; scrollbar-gutter:stable; }.panel-tools-modal-header { min-height:34px; display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:4px; }.panel-tools-modal-header h3,.panel-tools-modal-header h4 { margin:0; }.panel-tools-reset-all { min-height:34px; margin:0; white-space:nowrap; }.panel-tools-modal .modal-actions { flex:0 0 auto; margin:16px 0 0; padding-top:16px; background:transparent; border-top:1px solid var(--border-color,rgba(127,127,127,.35)); }
            .panel-tools-hint { margin:0 0 4px; color:var(--text-muted,currentColor); opacity:.72; font:400 13px/1.35 system-ui; }.panel-tools-option { display:flex !important; align-items:center; justify-content:space-between; gap:10px; padding:10px 0; margin:0 !important; color:var(--text-main,inherit) !important; font:400 13px/1.35 system-ui !important; cursor:pointer; border-bottom:1px solid var(--border-color,rgba(127,127,127,.35)); }.panel-tools-option .switch,.panel-tools-legend-row .switch { flex:0 0 auto; }.panel-tools-option small { color:var(--text-muted,currentColor); }
            .panel-tools-transform { border-bottom:1px solid var(--border-color,rgba(127,127,127,.35)); }.panel-tools-transform > .panel-tools-option { border-bottom:0; }.panel-tools-threshold { margin:0 0 7px 16px; padding-left:12px; border-left:2px solid var(--border-color,rgba(127,127,127,.35)); }.panel-tools-threshold .panel-tools-option { border-bottom:0; padding:7px 0; font-size:12px !important; }.panel-tools-threshold-value { display:block; padding:3px 0 7px; color:var(--text-muted,currentColor); font:400 12px/1.35 system-ui; }.panel-tools-threshold-value input { width:53px; margin:0 3px; padding:3px 6px; border:1px solid var(--border-color,rgba(127,127,127,.35)); border-radius:4px; color:var(--text-main,inherit); background:var(--card-bg,transparent); }
            .panel-tools-option-copy { display:grid; gap:2px; min-width:0; }.panel-tools-option-copy small { color:var(--text-muted,currentColor); opacity:.78; font:400 11.5px/1.3 system-ui; }.panel-tools-capacity-filter .panel-tools-threshold-value input { width:64px; }.panel-tools-capacity-hint { display:block; margin-top:9px; padding-bottom:3px; color:var(--text-muted,currentColor); opacity:.78; font:400 11.5px/1.35 system-ui; }
            .panel-tools-toggle-hint { display:block; margin:-2px 46px 9px 0; color:var(--text-muted,currentColor); opacity:.78; font:400 11.5px/1.35 system-ui; }.panel-tools-toggle-hint[hidden] { display:none !important; }
            .panel-tools-capacity-types { display:grid; gap:0; margin:2px 0 10px; padding:8px 0; border-top:1px solid var(--border-color,rgba(127,127,127,.25)); border-bottom:1px solid var(--border-color,rgba(127,127,127,.25)); }.panel-tools-capacity-types > span { margin-bottom:3px; color:var(--text-muted,currentColor); font:600 11.5px/1.3 system-ui; }.panel-tools-capacity-types > label { display:flex; align-items:center; justify-content:space-between; gap:12px; min-height:32px; color:var(--text-main,inherit); font:400 12px/1.3 system-ui; cursor:pointer; }.panel-tools-capacity-types .switch { transform:scale(.82); transform-origin:right center; }
            .panel-alert-threshold { margin:0 !important; padding:0 !important; border:0 !important; border-bottom:1px solid var(--border-color,rgba(127,127,127,.35)) !important; border-radius:0; background:transparent; }.panel-alert-threshold > .panel-tools-option { margin:0 !important; border-bottom:0; }.panel-alert-threshold-details { margin:0 0 9px 16px; padding-left:12px; border-left:2px solid var(--border-color,rgba(127,127,127,.35)); }.panel-alert-threshold-details[hidden] { display:none !important; }.panel-alert-threshold .panel-tools-threshold-value { display:flex; align-items:center; flex-wrap:wrap; gap:6px; padding:9px 0; }.panel-alert-threshold .panel-tools-threshold-value input { width:88px; margin:0; }.panel-threshold-unit { color:var(--text-muted,currentColor); }.panel-alert-notify-option { border-top:1px solid var(--border-color,rgba(127,127,127,.25)); border-bottom:0; }.panel-alert-notify-copy { display:grid; gap:2px; }
            .panel-tools-filter { margin:16px 0 0; padding:12px; border:1px solid var(--border-color,rgba(127,127,127,.35)); border-radius:var(--radius-md,6px); background:var(--bg-elevated,rgba(127,127,127,.045)); }.panel-tools-legend-header { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:13px; }.panel-tools-legend-header label { margin:0 !important; color:var(--text-main,inherit) !important; font:700 14px/1.3 system-ui !important; }.panel-tools-legend-header .btn,.panel-tools-legend-actions .btn { min-height:28px; padding:5px 10px; font-size:12px; white-space:nowrap; }.panel-tools-legend-section { margin-top:12px; padding-top:12px; border-top:1px solid var(--border-color,rgba(127,127,127,.3)); }.panel-tools-legend-section-title { display:block; margin:0 0 8px; color:var(--text-main,inherit); font:700 11.5px/1.3 system-ui; letter-spacing:.035em; text-transform:uppercase; }.panel-tools-legend-actions { display:flex; align-items:center; flex-wrap:wrap; gap:7px; margin-top:11px; }.panel-tools-legend-active-only { display:flex; align-items:center; gap:6px; margin:0 0 0 auto; color:var(--text-muted,currentColor); font:400 12px/1.3 system-ui; white-space:nowrap; cursor:pointer; }.panel-tools-legend-active-only .switch { transform:scale(.8); transform-origin:right center; }.panel-tools-legend-patterns { display:grid; gap:10px; }.panel-tools-pattern-field { display:grid; gap:5px; margin:0 !important; }.panel-tools-pattern-label { display:block; margin:0; color:var(--text-muted,currentColor); font:500 12px/1.3 system-ui; }.panel-tools-pattern-input { width:100%; min-height:36px; box-sizing:border-box; margin:0 !important; padding:9px 10px !important; border:1px solid var(--border-color,#cbd5e1) !important; border-radius:6px !important; outline:0; background:var(--card-bg,#fff) !important; color:var(--text-main,#182033) !important; font:400 13px/1.25 system-ui !important; box-shadow:0 1px 2px rgba(15,23,42,.06); }.panel-tools-pattern-input:hover { border-color:var(--text-muted,#94a3b8) !important; }.panel-tools-pattern-input:focus { border-color:var(--primary,#2563eb) !important; box-shadow:0 0 0 2px rgba(37,99,235,.18); }.panel-tools-pattern-input::placeholder { color:var(--text-muted,#64748b); opacity:.72; }.panel-tools-legend-list { max-height:220px; min-height:42px; overflow:auto; border:1px solid var(--border-color,rgba(127,127,127,.4)); border-radius:6px; background:var(--card-bg,#fff); box-shadow:0 1px 2px rgba(15,23,42,.05); }.panel-tools-legend-row { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:9px 11px; margin:0 !important; color:var(--text-main,inherit) !important; font:400 13px/1.25 system-ui; cursor:pointer; border-bottom:1px solid var(--border-color,rgba(127,127,127,.35)); transition:background-color .15s ease; }.panel-tools-legend-row:hover { background:rgba(37,99,235,.07); }.panel-tools-legend-row:last-child { border-bottom:0; }.panel-tools-legend-row > span { overflow-wrap:anywhere; flex:1 1 auto; }.panel-tools-legend-mode { display:grid; gap:8px; margin:0; color:var(--text-muted,currentColor); font:400 13px/1.3 system-ui; }.panel-tools-legend-mode label { display:flex; align-items:flex-start; gap:7px; margin:0 !important; font:inherit !important; color:inherit; cursor:pointer; }.panel-tools-legend-mode input[type="radio"] { width:auto; padding:0; margin:2px 0 0; border:0; background:transparent; accent-color:var(--primary,#2563eb); flex:0 0 auto; }
            .panel-tools-legend-row[hidden] { display:none; }
            .thicken-lines-container { display:flex; align-items:center; gap:8px; padding:0 0 11px; }.thicken-lines-container input { flex:1 1 auto; }.thicken-lines-display { min-width:40px; text-align:right; color:var(--text-muted,currentColor); font-variant-numeric:tabular-nums; }
        `;
        style.textContent += `
            /* The modal also runs on native Grafana pages, so its scale is
               carried by the overlay font-size instead of relying on host CSS. */
            .dashbridge-panel-settings-overlay { box-sizing:border-box; padding:1.2308em; }
            .dashbridge-panel-settings {
                width:min(35.3846em,calc(100vw - 2.4616em));
                max-height:calc(100dvh - 2.4616em);
                padding:1.5385em;
                border-radius:.6154em;
                box-shadow:0 1.5385em 1.9231em -.3846em rgba(0,0,0,.2);
            }
            .dashbridge-panel-settings h3 { font-size:1.3846em; }
            .dashbridge-panel-settings > .panel-tools-scroll,.panel-tools-scroll { padding-right:1.2308em; }
            .panel-tools-footer { gap:.6154em; margin-top:1.3846em; padding-top:1.0769em; }
            .panel-tools-footer button { min-height:2.8571em; padding:.5714em .8571em; border-radius:.4286em; font-size:1.0769em; }
            .dashbridge-panel-settings .btn,.panel-tools-modal .btn { gap:.5714em; padding:.5714em 1.1429em; border-radius:.4286em; font-size:1.0769em; }
            .dashbridge-panel-settings .switch,.panel-tools-modal .switch { width:2.9231em; height:1.6923em; }
            .dashbridge-panel-settings .slider::before,.panel-tools-modal .slider::before { width:1.0769em; height:1.0769em; left:.3077em; bottom:.3077em; }
            .dashbridge-panel-settings .switch input:checked + .slider::before,.panel-tools-modal .switch input:checked + .slider::before { transform:translateX(1.2308em); }
            .panel-tools-modal { max-width:40em; max-height:calc(100dvh - 2.4616em); }
            .panel-tools-modal-header { min-height:2.6154em; gap:1.2308em; margin-bottom:.3077em; }
            .panel-tools-reset-all { min-height:2.6154em; }
            .panel-tools-modal .modal-actions { margin-top:1.2308em; padding-top:1.2308em; }
            .panel-tools-hint { margin-bottom:.3077em; font-size:1em; }
            .panel-tools-option { gap:.7692em; padding:.7692em 0; font-size:1em !important; }
            .panel-tools-threshold { margin:0 0 .5385em 1.2308em; padding-left:.9231em; }
            .panel-tools-threshold .panel-tools-option { padding:.5833em 0; font-size:.9231em !important; }
            .panel-tools-threshold-value { padding:.25em 0 .5833em; font-size:.9231em; }
            .panel-tools-threshold-value input { width:4.4167em; margin:0 .25em; padding:.25em .5em; border-radius:.3333em; }
            .panel-tools-option-copy { gap:.1538em; }
            .panel-tools-option-copy small,.panel-tools-capacity-hint,.panel-tools-toggle-hint { font-size:.8846em; }
            .panel-tools-capacity-filter .panel-tools-threshold-value input { width:5.3333em; }
            .panel-tools-capacity-hint { margin-top:.7826em; padding-bottom:.2609em; }
            .panel-tools-toggle-hint { margin:-.1739em 4em .7826em 0; }
            .panel-tools-capacity-types { margin:.1667em 0 .8333em; padding:.6667em 0; }
            .panel-tools-capacity-types > span { margin-bottom:.2609em; font-size:.8846em; }
            .panel-tools-capacity-types > label { gap:1em; min-height:2.6667em; font-size:.9231em; }
            .panel-alert-threshold-details { margin:0 0 .6923em 1.2308em; padding-left:.9231em; }
            .panel-alert-threshold .panel-tools-threshold-value { gap:.5em; padding:.75em 0; }
            .panel-alert-threshold .panel-tools-threshold-value input { width:7.3333em; }
            .panel-tools-filter { margin-top:1.2308em; padding:.9231em; border-radius:.4615em; }
            .panel-tools-legend-header { gap:.9231em; margin-bottom:1em; }
            .panel-tools-legend-header label { font-size:1.0769em !important; }
            .panel-tools-legend-header .btn,.panel-tools-legend-actions .btn { min-height:2.3333em; padding:.4167em .8333em; font-size:.9231em; }
            .panel-tools-legend-section { margin-top:.9231em; padding-top:.9231em; }
            .panel-tools-legend-section-title { margin-bottom:.6957em; font-size:.8846em; }
            .panel-tools-legend-actions { gap:.5385em; margin-top:.8462em; }
            .panel-tools-legend-active-only { gap:.4615em; font-size:.9231em; }
            .panel-tools-legend-patterns { gap:.7692em; }
            .panel-tools-pattern-field { gap:.3846em; }
            .panel-tools-pattern-label { font-size:.9231em; }
            .panel-tools-pattern-input { min-height:2.7692em; padding:.6923em .7692em !important; border-radius:.4615em !important; font-size:1em !important; }
            .panel-tools-legend-list { max-height:16.9231em; min-height:3.2308em; border-radius:.4615em; }
            .panel-tools-legend-row { gap:.7692em; padding:.6923em .8462em; font-size:1em; }
            .panel-tools-legend-mode { gap:.6154em; font-size:1em; }
            .panel-tools-legend-mode label { gap:.5385em; }
            .panel-tools-legend-mode input[type="radio"] { margin-top:.1538em; }
            .thicken-lines-container { gap:.6154em; padding-bottom:.8462em; }
            .thicken-lines-display { min-width:3.0769em; }
            @media (max-width:480px) {
                .panel-tools-modal-header { align-items:stretch; flex-direction:column; gap:.6154em; }
                .panel-tools-reset-all { width:100%; white-space:normal; }
                .panel-alert-threshold-details,.panel-tools-threshold { margin-left:.6154em; padding-left:.6154em; }
                .panel-tools-footer { flex-wrap:wrap; }
                .panel-tools-footer button { min-width:8em; }
            }
        `;
        document.documentElement.appendChild(style);
    };

    const visualFields = (state = {}, attribute = 'data-key') => {
        const width = Number(state.thickenLinesValue || 1.5);
        return `
            <div class="panel-tools-transform"><label class="panel-tools-option"><span>Убрать заливку графика</span><span class="switch"><input type="checkbox" ${attribute}="removeFill" ${state.removeFill ? 'checked' : ''}><span class="slider"></span></span></label><small class="panel-tools-toggle-hint" data-toggle-hint="removeFill" ${state.removeFill ? '' : 'hidden'}>Оставляет только линии без цветной области под ними.</small></div>
            <div class="panel-tools-transform"><label class="panel-tools-option"><span>Утолщить линии графика</span><span class="switch"><input type="checkbox" ${attribute}="thickenLines" ${state.thickenLines ? 'checked' : ''}><span class="slider"></span></span></label><small class="panel-tools-toggle-hint" data-toggle-hint="thickenLines" ${state.thickenLines ? '' : 'hidden'}>Делает линии заметнее; толщину можно настроить ниже.</small><label class="thicken-lines-container" style="display:${state.thickenLines ? 'flex' : 'none'}"><span>Толщина</span><input type="range" ${attribute}="thickenLinesValue" min="0.5" max="5" step="0.5" value="${width}"><span class="thicken-lines-display">+${width.toFixed(1)}</span></label></div>
            <div class="panel-tools-transform"><label class="panel-tools-option"><span>Переместить легенду: справа ↔ снизу</span><span class="switch"><input type="checkbox" ${attribute}="invertLegend" ${state.invertLegend ? 'checked' : ''}><span class="slider"></span></span></label><small class="panel-tools-toggle-hint" data-toggle-hint="invertLegend" ${state.invertLegend ? '' : 'hidden'}>Справа удобнее длинные названия, снизу остаётся больше ширины графика.</small></div>`;
    };
    const normalizeExternalText = (value, maxLength = 96) => String(value ?? '')
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .trim()
        .slice(0, maxLength);
    const escapeHtmlAttribute = value => normalizeExternalText(value, 512).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const escapeHtmlText = value => normalizeExternalText(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const legendFields = (_mode = 'fast_complete_hide', state = {}) => `<div class="form-group panel-tools-filter">
        <div class="panel-tools-legend-header"><label>Серии легенды</label><button type="button" class="btn btn-primary panel-tools-refresh">Обновить список</button></div>
        <div class="panel-tools-legend-actions"><button type="button" class="btn btn-outline panel-tools-reset">Показать все</button><label class="panel-tools-legend-active-only"><span>Только включённые</span><span class="switch"><input type="checkbox" name="legendShowActiveOnly"><span class="slider"></span></span></label></div>
        <section class="panel-tools-legend-section" aria-labelledby="panel-tools-legend-pattern-title">
            <span id="panel-tools-legend-pattern-title" class="panel-tools-legend-section-title">Быстрый выбор</span>
            <div class="panel-tools-legend-patterns">
                <label class="panel-tools-pattern-field" for="legend-select-filter"><span class="panel-tools-pattern-label">Выбрать серии</span><input id="legend-select-filter" type="search" class="form-input panel-tools-pattern-input" name="legendSelectFilter" placeholder="Например: cpu|load" value="${escapeHtmlAttribute(state.legendSelectFilter)}"></label>
                <label class="panel-tools-pattern-field" for="legend-ignore-filter"><span class="panel-tools-pattern-label">Игнорировать серии</span><input id="legend-ignore-filter" type="search" class="form-input panel-tools-pattern-input" name="legendIgnoreFilter" placeholder="Например: idle|test" value="${escapeHtmlAttribute(state.legendIgnoreFilter)}"></label>
            </div>
        </section>
        <section class="panel-tools-legend-section" aria-labelledby="panel-tools-legend-list-title">
            <span id="panel-tools-legend-list-title" class="panel-tools-legend-section-title">Серии на графике</span>
            <div class="panel-tools-legend-list"><span class="panel-tools-hint">Загрузка серий…</span></div>
        </section>
    </div>`;
    const transformFields = (state = {}, { panelKind = null } = {}) => {
        const seriesQueryFilterValue = Number.isFinite(Number(state.seriesQueryFilterValue)) ? Number(state.seriesQueryFilterValue) : 0;
        const seriesQueryFilterMode = state.seriesQueryFilterMode === 'last' ? 'last' : 'max';
        const cpuCapacityFilterCoefficient = Number.isFinite(Number(state.cpuCapacityFilterCoefficient)) && Number(state.cpuCapacityFilterCoefficient) > 0
            ? Number(state.cpuCapacityFilterCoefficient) : 0.8;
        const cpuCapacityFilterMode = state.cpuCapacityFilterMode === 'last' ? 'last' : 'max';
        const cpuCapacityFilterLoad1 = state.cpuCapacityFilterLoad1 !== false;
        const cpuCapacityFilterLoad5 = state.cpuCapacityFilterLoad5 === true;
        const cpuCapacityFilterLoad15 = state.cpuCapacityFilterLoad15 === true;
        const seriesQueryFilterHighlightEnabled = state.seriesQueryFilterHighlightEnabled !== false;
        const cpuCapacityFilterHighlightEnabled = state.cpuCapacityFilterHighlightEnabled !== false;
        const safeThresholdUnit = escapeHtmlText(state.thresholdUnit);
        const seriesFilterUnit = panelKind === 'ram' && state.convertMemToUsed ? 'Единица: %' : (safeThresholdUnit ? `Единица: ${safeThresholdUnit}` : 'Единица определяется по графику');
        const filterBlock = ({ title, key, enabled, value, mode, highlightEnabled }) => `<div class="panel-tools-transform"><label class="panel-tools-option"><span>${title}</span><span class="switch"><input type="checkbox" name="${key}Enabled" ${enabled ? 'checked' : ''}><span class="slider"></span></span></label><div class="panel-tools-threshold" data-threshold="${key}"><label class="panel-tools-threshold-value">Показывать только серии со значением больше <input type="number" name="${key}Value" step="any" value="${value}"> <span class="panel-series-filter-unit">${seriesFilterUnit}</span></label><div class="panel-tools-legend-mode"><label><input type="radio" name="${key}Mode" value="max" ${mode === 'max' ? 'checked' : ''}> Максимум за период</label><label><input type="radio" name="${key}Mode" value="last" ${mode === 'last' ? 'checked' : ''}> Последнее значение</label></div><label class="panel-tools-option panel-tools-highlight-option"><span>Утолщать участки превышения</span><span class="switch"><input type="checkbox" name="${key}HighlightEnabled" ${highlightEnabled ? 'checked' : ''}><span class="slider"></span></span></label><small class="panel-tools-capacity-hint">Участки выше порога утолщаются, сохраняя цвет серии. Если порог не прошла ни одна серия, остаётся одна с наибольшим значением в выбранном режиме.</small></div></div>`;
        const cpuCapacityBlock = panelKind === 'load' ? `<div class="panel-tools-transform panel-tools-capacity-filter"><label class="panel-tools-option"><span>Фильтр Load Average по vCPU</span><span class="switch"><input type="checkbox" name="cpuCapacityFilterEnabled" ${state.cpuCapacityFilterEnabled ? 'checked' : ''}><span class="slider"></span></span></label><div class="panel-tools-threshold" data-threshold="cpuCapacityFilter"><label class="panel-tools-threshold-value">Порог: количество vCPU × <input type="number" name="cpuCapacityFilterCoefficient" min="0.01" max="10" step="0.05" value="${cpuCapacityFilterCoefficient}"></label><div class="panel-tools-capacity-types"><span>Показывать серии</span><label><span>Load 1m</span><span class="switch"><input type="checkbox" name="cpuCapacityFilterLoad1" ${cpuCapacityFilterLoad1 ? 'checked' : ''}><span class="slider"></span></span></label><label><span>Load 5m</span><span class="switch"><input type="checkbox" name="cpuCapacityFilterLoad5" ${cpuCapacityFilterLoad5 ? 'checked' : ''}><span class="slider"></span></span></label><small data-capacity-type-hint="5m" ${cpuCapacityFilterLoad5 ? '' : 'hidden'}>Сглаживает короткие скачки нагрузки.</small><label><span>Load 15m</span><span class="switch"><input type="checkbox" name="cpuCapacityFilterLoad15" ${cpuCapacityFilterLoad15 ? 'checked' : ''}><span class="slider"></span></span></label><small data-capacity-type-hint="15m" ${cpuCapacityFilterLoad15 ? '' : 'hidden'}>Показывает длительную устойчивую нагрузку.</small><small class="panel-tools-capacity-empty" ${cpuCapacityFilterLoad1 || cpuCapacityFilterLoad5 || cpuCapacityFilterLoad15 ? 'hidden' : ''}>Ни один тип не выбран — Load-серии будут скрыты.</small></div><div class="panel-tools-legend-mode"><label><input type="radio" name="cpuCapacityFilterMode" value="max" ${cpuCapacityFilterMode === 'max' ? 'checked' : ''}> Максимум за период</label><label><input type="radio" name="cpuCapacityFilterMode" value="last" ${cpuCapacityFilterMode === 'last' ? 'checked' : ''}> Последнее значение</label></div><label class="panel-tools-option panel-tools-highlight-option"><span>Утолщать участки превышения</span><span class="switch"><input type="checkbox" name="cpuCapacityFilterHighlightEnabled" ${cpuCapacityFilterHighlightEnabled ? 'checked' : ''}><span class="slider"></span></span></label><small class="panel-tools-capacity-hint">Порог для каждой VM рассчитывается как vCPU × коэффициент. Участки выше порога утолщаются в цвете серии. Если количество CPU не определено, серия остаётся видимой.</small></div></div>` : '';
        const cpuBlock = panelKind === 'cpu' ? `<div class="panel-tools-transform"><label class="panel-tools-option"><span>Инвертировать CPU-график: Idle → Load</span><span class="switch"><input type="checkbox" name="invertIdle" ${state.invertIdle ? 'checked' : ''}><span class="slider"></span></span></label><small class="panel-tools-toggle-hint" data-toggle-hint="invertIdle" ${state.invertIdle ? '' : 'hidden'}>Показывает загрузку CPU как 100% − Idle.</small></div>` : '';
        const memBlock = panelKind === 'ram' ? `<div class="panel-tools-transform"><label class="panel-tools-option"><span>Конвертировать RAM-график в % Used</span><span class="switch"><input type="checkbox" name="convertMemToUsed" ${state.convertMemToUsed ? 'checked' : ''}><span class="slider"></span></span></label><small class="panel-tools-toggle-hint" data-toggle-hint="convertMemToUsed" ${state.convertMemToUsed ? '' : 'hidden'}>Рассчитывает занятую память в процентах из выбранной пары RAM-метрик.</small></div>` : '';
        const panelSpecificBlock = cpuBlock || memBlock || cpuCapacityBlock;
        return `${panelSpecificBlock}${filterBlock({ title: 'Фильтр отображаемых серий', key: 'seriesQueryFilter', enabled: state.seriesQueryFilterEnabled, value: seriesQueryFilterValue, mode: seriesQueryFilterMode, highlightEnabled: seriesQueryFilterHighlightEnabled })}`;
    };
    const thresholdFields = (state = {}) => {
        const safeThresholdUnit = escapeHtmlText(state.thresholdUnit);
        return `<div class="panel-tools-transform panel-alert-threshold"><label class="panel-tools-option"><span>Порог на графике</span><span class="switch"><input type="checkbox" name="thresholdEnabled" ${state.thresholdEnabled ? 'checked' : ''}><span class="slider"></span></span></label><div class="panel-alert-threshold-details" ${state.thresholdEnabled ? '' : 'hidden'}><div class="panel-alert-threshold-config"><label class="panel-tools-threshold-value">Значение порога <input type="number" name="thresholdValue" step="any" value="${state.thresholdValue || 0}"> <span class="panel-threshold-unit">${safeThresholdUnit ? `Единица: ${safeThresholdUnit}` : 'Единица определяется по графику'}</span></label></div><label class="panel-tools-option panel-alert-notify-option"><span class="panel-alert-notify-copy"><span>Уведомлять о превышении</span></span><span class="switch"><input type="checkbox" name="thresholdNotifyEnabled" ${state.thresholdNotifyEnabled !== false ? 'checked' : ''}><span class="slider"></span></span></label></div></div>`;
    };

    const selectLegendSeriesByPatterns = (names, include, ignore) => {
        const parse = value => String(value || '').toLowerCase().split('|').map(term => term.trim()).filter(Boolean);
        const includeTerms = parse(include);
        const ignoreTerms = parse(ignore);
        return names.filter(name => {
            const value = String(name).toLowerCase();
            return (!includeTerms.length || includeTerms.some(term => value.includes(term)))
                && !ignoreTerms.some(term => value.includes(term));
        });
    };

    const bindAdvancedControls = ({ overlay, state, getLegendSeries, getThresholdStatus, formatThresholdUnit, onSave, cpuCapacityFilterCoefficientDefault = 0.8 }) => {
        const defaultCpuCapacityCoefficient = Number.isFinite(Number(cpuCapacityFilterCoefficientDefault))
            && Number(cpuCapacityFilterCoefficientDefault) >= 0.01 && Number(cpuCapacityFilterCoefficientDefault) <= 10
            ? Number(cpuCapacityFilterCoefficientDefault) : 0.8;
        const legendSelection = globalThis.DashBridgeGrafanaLegendSelection;
        const field = name => overlay.querySelector(`[name="${name}"], [data-key="${name}"]`);
        const list = overlay.querySelector('.panel-tools-legend-list');
        const selectFilter = field('legendSelectFilter');
        const ignoreFilter = field('legendIgnoreFilter');
        const showActiveOnly = field('legendShowActiveOnly');
        const refreshLegendButton = overlay.querySelector('.panel-tools-refresh');
        const hiddenLegend = new Set(state.legendFilter || []);
        const savedVisibleLegend = new Set(legendSelection?.normalizeNames(state.legendVisibleSeries) || []);
        const hasSavedAllowlist = legendSelection?.isAllowlistState(state) || false;
        let legendLoaded = false;
        let legendRenderedOnce = false;
        let legendSelectionTouched = false;
        let legendResetRequested = false;
        const thresholdUnit = overlay.querySelector('.panel-threshold-unit');
        const seriesFilterUnits = overlay.querySelectorAll('.panel-series-filter-unit');
        const thresholdValueInput = field('thresholdValue');
        let thresholdRawValueDraft = state.thresholdRawValue;
        let thresholdStatus = null;
        const getSeriesFilterUnitText = () => field('convertMemToUsed')?.checked
            ? 'Единица: %'
            : (formatThresholdUnit?.(thresholdStatus) || 'Единица определяется по графику');
        const updateSeriesFilterUnits = () => {
            const text = getSeriesFilterUnitText();
            seriesFilterUnits.forEach(unit => { unit.textContent = text; });
        };
        const updateLegendVisibility = () => {
            list?.querySelectorAll('.panel-tools-legend-row').forEach(row => {
                const checkbox = row.querySelector('input');
                row.hidden = !!showActiveOnly?.checked && !checkbox?.checked;
            });
        };
        const applyLegendPatternSelection = () => {
            legendSelectionTouched = true;
            legendResetRequested = false;
            const rows = [...(list?.querySelectorAll('.panel-tools-legend-row') || [])];
            const selected = new Set(selectLegendSeriesByPatterns(rows.map(row => row.querySelector('input')?.value || ''), selectFilter?.value, ignoreFilter?.value));
            rows.forEach(row => {
                const checkbox = row.querySelector('input');
                if (!checkbox) return;
                checkbox.checked = selected.has(checkbox.value);
                checkbox.checked ? hiddenLegend.delete(checkbox.value) : hiddenLegend.add(checkbox.value);
            });
            updateLegendVisibility();
        };
        const renderLegend = series => {
            if (!list) return;
            list.innerHTML = '';
            if (!series.length) { list.innerHTML = '<span class="panel-tools-hint">Серии не найдены. Откройте легенду в Grafana и повторите попытку.</span>'; return; }
            legendLoaded = true;
            series.forEach(name => {
                const row = document.createElement('div'); row.className = 'panel-tools-legend-row';
                const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = name;
                checkbox.checked = hasSavedAllowlist && !legendRenderedOnce
                    ? savedVisibleLegend.has(name) : !hiddenLegend.has(name);
                checkbox.checked ? hiddenLegend.delete(name) : hiddenLegend.add(name);
                checkbox.addEventListener('change', () => {
                    legendSelectionTouched = true;
                    legendResetRequested = false;
                    checkbox.checked ? hiddenLegend.delete(name) : hiddenLegend.add(name);
                    updateLegendVisibility();
                });
                const text = document.createElement('span'); text.textContent = name;
                const toggle = document.createElement('label'); toggle.className = 'switch'; const slider = document.createElement('span'); slider.className = 'slider'; toggle.append(checkbox, slider);
                row.append(text, toggle); list.appendChild(row);
            });
            legendRenderedOnce = true;
            updateLegendVisibility();
        };
        const setLegendLoading = loading => {
            if (selectFilter) selectFilter.disabled = loading;
            if (ignoreFilter) ignoreFilter.disabled = loading;
            if (refreshLegendButton) refreshLegendButton.disabled = loading;
        };
        const refreshLegend = async () => {
            if (!list || !getLegendSeries) return;
            setLegendLoading(true);
            list.innerHTML = '<span class="panel-tools-hint">Загрузка серий…</span>';
            try {
                const series = await getLegendSeries();
                renderLegend(Array.isArray(series) ? series : []);
            } catch (_error) {
                list.innerHTML = '<span class="panel-tools-hint">Не удалось загрузить серии. Повторите попытку.</span>';
            } finally {
                setLegendLoading(false);
            }
        };
        const applyThresholdStatus = status => {
            thresholdStatus = status || thresholdStatus;
            const unitText = formatThresholdUnit?.(status) || 'Единица определяется по графику';
            if (thresholdUnit) thresholdUnit.textContent = unitText;
            updateSeriesFilterUnits();
            const factor = Number(status?.factor);
            if (thresholdValueInput && Number.isFinite(thresholdRawValueDraft) && Number.isFinite(factor) && factor > 0) thresholdValueInput.value = thresholdRawValueDraft / factor;
        };
        const updateThresholdVisibility = () => {
            const queryEnabled = !!field('seriesQueryFilterEnabled')?.checked;
            const query = overlay.querySelector('[data-threshold="seriesQueryFilter"]');
            const capacityEnabled = !!field('cpuCapacityFilterEnabled')?.checked;
            const capacity = overlay.querySelector('[data-threshold="cpuCapacityFilter"]');
            const thresholdEnabled = !!field('thresholdEnabled')?.checked;
            const alertDetails = overlay.querySelector('.panel-alert-threshold-details');
            const notifyInput = field('thresholdNotifyEnabled');
            if (query) query.hidden = !queryEnabled;
            if (capacity) capacity.hidden = !capacityEnabled;
            if (alertDetails) alertDetails.hidden = !thresholdEnabled;
            if (notifyInput) notifyInput.disabled = !thresholdEnabled;
        };
        const updateCapacityTypeHints = () => {
            const types = [['1m', 'cpuCapacityFilterLoad1'], ['5m', 'cpuCapacityFilterLoad5'], ['15m', 'cpuCapacityFilterLoad15']];
            let selectedCount = 0;
            types.forEach(([type, name]) => {
                const checked = !!field(name)?.checked;
                if (checked) selectedCount += 1;
                const hint = overlay.querySelector(`[data-capacity-type-hint="${type}"]`);
                if (hint) hint.hidden = !checked;
            });
            const empty = overlay.querySelector('.panel-tools-capacity-empty');
            if (empty) empty.hidden = selectedCount > 0;
        };
        const updateSimpleToggleHints = () => {
            overlay.querySelectorAll('[data-toggle-hint]').forEach(hint => {
                hint.hidden = !field(hint.dataset.toggleHint)?.checked;
            });
        };
        selectFilter?.addEventListener('input', applyLegendPatternSelection);
        ignoreFilter?.addEventListener('input', applyLegendPatternSelection);
        refreshLegendButton?.addEventListener('click', refreshLegend);
        overlay.querySelector('.panel-tools-reset')?.addEventListener('click', () => {
            legendSelectionTouched = false;
            legendResetRequested = true;
            hiddenLegend.clear();
            if (selectFilter) selectFilter.value = '';
            if (ignoreFilter) ignoreFilter.value = '';
            list?.querySelectorAll('.panel-tools-legend-row').forEach(row => {
                const checkbox = row.querySelector('input');
                checkbox.checked = true;
            });
            updateLegendVisibility();
        });
        showActiveOnly?.addEventListener('change', updateLegendVisibility);
        field('seriesQueryFilterEnabled')?.addEventListener('change', () => {
            if (field('seriesQueryFilterEnabled').checked && field('cpuCapacityFilterEnabled')) field('cpuCapacityFilterEnabled').checked = false;
            updateThresholdVisibility();
        });
        field('cpuCapacityFilterEnabled')?.addEventListener('change', () => {
            if (field('cpuCapacityFilterEnabled').checked && field('seriesQueryFilterEnabled')) field('seriesQueryFilterEnabled').checked = false;
            updateThresholdVisibility();
        });
        ['cpuCapacityFilterLoad1', 'cpuCapacityFilterLoad5', 'cpuCapacityFilterLoad15'].forEach(name => {
            field(name)?.addEventListener('change', updateCapacityTypeHints);
        });
        ['removeFill', 'thickenLines', 'invertLegend', 'invertIdle', 'convertMemToUsed'].forEach(name => {
            field(name)?.addEventListener('change', updateSimpleToggleHints);
        });
        field('convertMemToUsed')?.addEventListener('change', updateSeriesFilterUnits);
        field('thresholdEnabled')?.addEventListener('change', async () => { updateThresholdVisibility(); if (field('thresholdEnabled').checked && getThresholdStatus) applyThresholdStatus(await getThresholdStatus()); });
        const thicken = field('thickenLines'); const thickness = field('thickenLinesValue'); const thicknessBox = overlay.querySelector('.thicken-lines-container'); const thicknessLabel = overlay.querySelector('.thicken-lines-display');
        const updateThicknessControls = () => {
            if (thicknessBox) thicknessBox.style.display = thicken?.checked ? 'flex' : 'none';
            if (thicknessLabel) thicknessLabel.textContent = `+${Number(thickness?.value || 1.5).toFixed(1)}`;
        };
        thicken?.addEventListener('change', updateThicknessControls);
        thickness?.addEventListener('input', updateThicknessControls);
        overlay.querySelector('.panel-tools-reset-all')?.addEventListener('click', () => {
            ['removeFill', 'thickenLines', 'invertLegend', 'invertIdle', 'convertMemToUsed', 'seriesQueryFilterEnabled', 'cpuCapacityFilterEnabled', 'cpuCapacityFilterLoad5', 'cpuCapacityFilterLoad15', 'thresholdEnabled'].forEach(name => { if (field(name)) field(name).checked = false; });
            if (field('cpuCapacityFilterLoad1')) field('cpuCapacityFilterLoad1').checked = true;
            if (field('seriesQueryFilterHighlightEnabled')) field('seriesQueryFilterHighlightEnabled').checked = true;
            if (field('cpuCapacityFilterHighlightEnabled')) field('cpuCapacityFilterHighlightEnabled').checked = true;
            if (field('thresholdNotifyEnabled')) field('thresholdNotifyEnabled').checked = true;
            [['thickenLinesValue', 1.5], ['seriesQueryFilterValue', 0], ['cpuCapacityFilterCoefficient', defaultCpuCapacityCoefficient], ['thresholdValue', 0]].forEach(([name, value]) => { if (field(name)) field(name).value = value; });
            overlay.querySelector('[name="seriesQueryFilterMode"][value="max"]')?.click();
            overlay.querySelector('[name="cpuCapacityFilterMode"][value="max"]')?.click();
            hiddenLegend.clear(); legendSelectionTouched = false; legendResetRequested = true; thresholdRawValueDraft = null; if (selectFilter) selectFilter.value = ''; if (ignoreFilter) ignoreFilter.value = ''; list?.querySelectorAll('.panel-tools-legend-row').forEach(row => { row.querySelector('input').checked = true; }); updateThresholdVisibility(); updateCapacityTypeHints(); updateSimpleToggleHints(); updateThicknessControls(); updateSeriesFilterUnits();
        });
        overlay.querySelector('.panel-tools-cancel')?.addEventListener('click', () => overlay.remove());
        overlay.querySelector('.panel-tools-save')?.addEventListener('click', async () => {
            list?.querySelectorAll('.panel-tools-legend-row').forEach(row => { const checkbox = row.querySelector('input'); checkbox.checked ? hiddenLegend.delete(checkbox.value) : hiddenLegend.add(checkbox.value); });
            const legendMode = 'fast_complete_hide';
            const visibleLegend = legendLoaded
                ? [...(list?.querySelectorAll('.panel-tools-legend-row input:checked') || [])].map(input => input.value)
                : [...savedVisibleLegend];
            const keepAllowlist = !legendResetRequested && (hasSavedAllowlist || legendSelectionTouched) && (legendLoaded || hasSavedAllowlist);
            const keepLegacyFilter = !legendResetRequested && !keepAllowlist && hiddenLegend.size > 0;
            const thresholdValue = Number(thresholdValueInput?.value) || 0; const factor = Number(thresholdStatus?.factor);
            const seriesQueryFilterValue = Number(field('seriesQueryFilterValue')?.value);
            const cpuCapacityFilterCoefficient = Number(field('cpuCapacityFilterCoefficient')?.value);
            const convertMemToUsed = !!field('convertMemToUsed')?.checked;
            const seriesQueryFilterRawValue = Number.isFinite(seriesQueryFilterValue)
                ? (convertMemToUsed ? seriesQueryFilterValue : (Number.isFinite(factor) && factor > 0 ? seriesQueryFilterValue * factor : seriesQueryFilterValue))
                : null;
            await onSave?.({ ...readVisualState(overlay), invertIdle: !!field('invertIdle')?.checked, convertMemToUsed, seriesFilterSettingsVersion: 2, seriesQueryFilterEnabled: !!field('seriesQueryFilterEnabled')?.checked, seriesQueryFilterHighlightEnabled: field('seriesQueryFilterHighlightEnabled')?.checked !== false, seriesQueryFilterValue: Number.isFinite(seriesQueryFilterValue) ? seriesQueryFilterValue : 0, seriesQueryFilterRawValue, seriesQueryFilterMode: overlay.querySelector('[name="seriesQueryFilterMode"]:checked')?.value === 'last' ? 'last' : 'max', cpuCapacityFilterEnabled: !!field('cpuCapacityFilterEnabled')?.checked, cpuCapacityFilterHighlightEnabled: field('cpuCapacityFilterHighlightEnabled')?.checked !== false, cpuCapacityFilterCoefficient: Number.isFinite(cpuCapacityFilterCoefficient) && cpuCapacityFilterCoefficient > 0 ? cpuCapacityFilterCoefficient : defaultCpuCapacityCoefficient, cpuCapacityFilterMode: overlay.querySelector('[name="cpuCapacityFilterMode"]:checked')?.value === 'last' ? 'last' : 'max', cpuCapacityFilterLoad1: !!field('cpuCapacityFilterLoad1')?.checked, cpuCapacityFilterLoad5: !!field('cpuCapacityFilterLoad5')?.checked, cpuCapacityFilterLoad15: !!field('cpuCapacityFilterLoad15')?.checked, thresholdEnabled: !!field('thresholdEnabled')?.checked, thresholdNotifyEnabled: field('thresholdNotifyEnabled')?.checked !== false, thresholdValue, thresholdRawValue: Number.isFinite(factor) && factor > 0 ? thresholdValue * factor : thresholdRawValueDraft, thresholdUnit: normalizeExternalText(thresholdStatus?.unit || state.thresholdUnit), legendMode, legendFilter: keepLegacyFilter ? [...hiddenLegend] : [], legendSelectionVersion: keepAllowlist ? (legendSelection?.VERSION || 2) : null, legendVisibleSeries: keepAllowlist ? visibleLegend : [], legendSearch: '', legendSelectFilter: selectFilter?.value || '', legendIgnoreFilter: ignoreFilter?.value || '' });
            overlay.remove();
        });
        updateThresholdVisibility(); updateCapacityTypeHints(); updateSimpleToggleHints(); if (getThresholdStatus) getThresholdStatus().then(applyThresholdStatus); void refreshLegend();
    };

    const createOverlay = () => {
        const overlay = document.createElement('div');
        overlay.className = 'dashbridge-panel-settings-overlay';
        const root = document.documentElement;
        const body = document.body;
        const dark = root?.getAttribute('data-theme') === 'dark'
            || root?.classList?.contains('theme-dark')
            || body?.classList?.contains('theme-dark');
        overlay.classList.toggle('dashbridge-panel-settings-dark', dark);
        overlay.style.fontSize = `${13 * getInterfaceScale()}px`;
        return overlay;
    };

    const open = ({ state = {}, onSave, content = '', onReady = null, advanced = null }) => {
        ensureStyles(); document.querySelector('.dashbridge-panel-settings-overlay')?.remove();
        const overlay = createOverlay();
        overlay.innerHTML = `<div class="dashbridge-panel-settings" role="dialog" aria-modal="true" aria-labelledby="dashbridge-panel-settings-title"><div class="panel-tools-modal-header"><h3 id="dashbridge-panel-settings-title">Настройки графика</h3><button type="button" class="btn btn-outline panel-tools-reset-all">Сбросить всё</button></div><div class="panel-tools-scroll"><p class="panel-tools-hint">Применяются только к этому графику.</p>${visualFields(state)}${content}</div><div class="panel-tools-footer"><button type="button" class="cancel">Отмена</button><button type="button" class="save">Сохранить</button></div></div>`;
        Object.entries(state).forEach(([key, value]) => { const input = overlay.querySelector(`[data-key="${key}"]`); if (input) input.type === 'checkbox' ? input.checked = !!value : input.value = value; });
        onReady?.(overlay);
        // Keep unsaved panel settings open until the user explicitly cancels
        // or saves them. A click on the backdrop is easy to make by mistake.
        overlay.onclick = event => { if (event.target.closest('.cancel')) overlay.remove(); };
        const saveButton = overlay.querySelector('.save');
        if (advanced) {
            saveButton.classList.add('panel-tools-save');
            overlay.querySelector('.cancel').classList.add('panel-tools-cancel');
            bindAdvancedControls({ overlay, state, onSave, ...advanced });
        } else {
            saveButton.onclick = async () => { const next = {}; overlay.querySelectorAll('[data-key]').forEach(input => { next[input.dataset.key] = input.type === 'checkbox' ? input.checked : Number(input.value); }); await onSave?.(next); overlay.remove(); };
        }
        document.body.appendChild(overlay); return overlay;
    };
    const create = ({ html }) => { ensureStyles(); document.querySelector('.dashbridge-panel-settings-overlay')?.remove(); const overlay = createOverlay(); overlay.innerHTML = html; document.body.appendChild(overlay); return overlay; };
    const readVisualState = root => ({ removeFill: root.querySelector('[name="removeFill"], [data-key="removeFill"]')?.checked || false, thickenLines: root.querySelector('[name="thickenLines"], [data-key="thickenLines"]')?.checked || false, thickenLinesValue: Number(root.querySelector('[name="thickenLinesValue"], [data-key="thickenLinesValue"]')?.value || 1.5), invertLegend: root.querySelector('[name="invertLegend"], [data-key="invertLegend"]')?.checked || false });
    window.DashBridgePanelSettingsModal = { open, create, readVisualState, visualFields, legendFields, transformFields, thresholdFields, bindAdvancedControls, selectLegendSeriesByPatterns, normalizeExternalText };
})();
