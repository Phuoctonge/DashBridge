# Аудит размеров и границ файлов DashBridge

Дата: 2026-09-01. Ветка/версия анализа: main после коммита `9e6d178`.

## Область и критерии

Проверены 395 tracked-файлов, существовавших до создания этого отчёта. Игнорируемые `node_modules/`, `dist/`, `test-results/` и индекс GitNexus не входят в аудит. Для бинарных assets количество строк неприменимо. Канонический production-контур содержит 134 JavaScript-модуля.

Решение основано не только на размере: учитывались context/trust boundary, владелец mutable state, lifecycle/cleanup, потребители, script order и самостоятельность тестирования. Цель 300–500 строк и предел 700 строк применяются к новому handwritten production JS; существующий крупный единый state machine не делится механически.

## Итог

- Разделить сейчас: 4 JavaScript-файла и 3 CSS-файла.
- Объединить: 0 файлов. После удаления искусственного `grafana-panel-tools-bridge.js` новых proxy-пар не найдено.
- Оставить под документированным no-growth budget: 8 крупных единых state/lifecycle-модулей.
- Остальные файлы оставить в текущих границах.

### Рекомендуемое разделение

1. `pages/options/options.js` — отделить schema/validation/import/export от settings DOM-controller.
2. `pages/worklog/worklog.js` — отделить Jira HTTP/payload adapter от таблицы, history и page state.
3. `pages/shared/theme.css` — оставить shared tokens/reset/components; page-specific dark/legacy overrides перенести в CSS соответствующих страниц.
4. `pages/dashbridge/dashbridge.css` — разделить base/cards, dialogs/time picker и report/SLA styles.
5. `pages/batch/batch.css` — разделить base/progress и panel/series workflow styles.
6. `pages/test-runner/test-runner-diagnostics.js` — вынести чистый diagnostic diff из Chrome/MAIN capture lifecycle.
7. `pages/test-runner/test-runner-ui.js` — вынести diagnostic viewer и export/report actions; оставить page/run coordinator.

Test Runner остаётся последним этапом: его границы меняются только после production UI/CSS и с полным E2E contract-run.

## Production JavaScript

| Строк | Байт | Решение | Файл |
|---:|---:|---|---|
| 172 | 9150 | ОСТАВИТЬ — граница ответственности оправдана | `js/background-grafana-infrastructure.js` |
| 181 | 9561 | ОСТАВИТЬ — граница ответственности оправдана | `js/background-gui-capture.js` |
| 159 | 9258 | ОСТАВИТЬ — граница ответственности оправдана | `js/background-profile-storage.js` |
| 168 | 9168 | ОСТАВИТЬ — граница ответственности оправдана | `js/background.js` |
| 297 | 20533 | ОСТАВИТЬ — граница ответственности оправдана | `js/content/content.js` |
| 133 | 7086 | ОСТАВИТЬ — граница ответственности оправдана | `js/content/grafana-compact-layout.js` |
| 386 | 18434 | ОСТАВИТЬ — граница ответственности оправдана | `js/content/grafana-cpu-capacity-filter.js` |
| 314 | 16262 | ОСТАВИТЬ — граница ответственности оправдана | `js/content/grafana-cpu-capacity-legend.js` |
| 97 | 5630 | ОСТАВИТЬ — граница ответственности оправдана | `js/content/grafana-dom.js` |
| 349 | 15993 | ОСТАВИТЬ — граница ответственности оправдана | `js/content/grafana-iframe.js` |
| 565 | 28139 | ОСТАВИТЬ — граница ответственности оправдана | `js/content/grafana-legend-visibility-adapters.js` |
| 985 | 60556 | ОСТАВИТЬ — единый state/lifecycle, no-growth budget | `js/content/grafana-legend-visuals.js` |
| 35 | 1518 | ОСТАВИТЬ — граница ответственности оправдана | `js/content/grafana-network.js` |
| 499 | 31942 | ОСТАВИТЬ — граница ответственности оправдана | `js/content/grafana-panel-capture-runtime.js` |
| 711 | 45436 | ОСТАВИТЬ — единый state/lifecycle, no-growth budget | `js/content/grafana-panel-data-runtime.js` |
| 549 | 32368 | ОСТАВИТЬ — граница ответственности оправдана | `js/content/grafana-panel-data-transforms.js` |
| 166 | 9176 | ОСТАВИТЬ — граница ответственности оправдана | `js/content/grafana-panel-definition.js` |
| 592 | 42532 | ОСТАВИТЬ — граница ответственности оправдана | `js/content/grafana-panel-menu-runtime.js` |
| 29 | 1041 | ОСТАВИТЬ — граница ответственности оправдана | `js/content/grafana-panel-state.js` |
| 2287 | 131168 | ОСТАВИТЬ — единый state/lifecycle, no-growth budget | `js/content/grafana-panel-tools.js` |
| 71 | 2917 | ОСТАВИТЬ — граница ответственности оправдана | `js/content/grafana-refresh-policy.js` |
| 264 | 17240 | ОСТАВИТЬ — граница ответственности оправдана | `js/content/grafana-report-snapshot.js` |
| 85 | 4588 | ОСТАВИТЬ — граница ответственности оправдана | `js/content/grafana-series-capture.js` |
| 242 | 13162 | ОСТАВИТЬ — граница ответственности оправдана | `js/content/grafana-series-styles.js` |
| 85 | 5324 | ОСТАВИТЬ — граница ответственности оправдана | `js/content/grafana-table-report.js` |
| 772 | 44496 | ОСТАВИТЬ — единый state/lifecycle, no-growth budget | `js/content/grafana-threshold-visuals.js` |
| 214 | 11570 | ОСТАВИТЬ — граница ответственности оправдана | `js/content/grafana-time-picker-clipboard.js` |
| 112 | 4353 | ОСТАВИТЬ — граница ответственности оправдана | `js/content/grafana-unit.js` |
| 231 | 11087 | ОСТАВИТЬ — граница ответственности оправдана | `js/content/grafana-visual-engine.js` |
| 90 | 3440 | ОСТАВИТЬ — граница ответственности оправдана | `js/content/inject.js` |
| 174 | 7893 | ОСТАВИТЬ — граница ответственности оправдана | `js/content/scenario-recorder.js` |
| 17 | 781 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/archive-budget.js` |
| 52 | 2351 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/archive-download.js` |
| 51 | 1927 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/bounded-journal.js` |
| 72 | 3836 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/dashbridge-profile-store.js` |
| 241 | 14208 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/dashbridge-report.js` |
| 62 | 3008 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/dashflow-compare.js` |
| 201 | 11253 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/dashflow-schema.js` |
| 178 | 16591 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/dashflow-xlsx.js` |
| 41 | 1993 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/dnr-rules.js` |
| 67 | 2906 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/grafana-batch-panel-rules.js` |
| 70 | 3961 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/grafana-capture-output.js` |
| 43 | 2654 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/grafana-command.js` |
| 107 | 4463 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/grafana-dashboard-api.js` |
| 54 | 2955 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/grafana-legend-engine.js` |
| 60 | 2845 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/grafana-legend-selection.js` |
| 377 | 21322 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/grafana-panel-analysis.js` |
| 106 | 4503 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/grafana-panel-bootstrap.js` |
| 128 | 7206 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/grafana-panel-capture.js` |
| 33 | 1473 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/grafana-panel-identity.js` |
| 412 | 52782 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/grafana-panel-settings-modal.js` |
| 46 | 2161 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/grafana-runtime-manifest.js` |
| 59 | 2983 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/grafana-runtime.js` |
| 74 | 3927 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/grafana-settings.js` |
| 50 | 1976 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/grafana-time.js` |
| 127 | 5764 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/grafana-url.js` |
| 341 | 20168 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/local-state-schema.js` |
| 88 | 3861 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/storage-writer.js` |
| 60 | 2311 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/sync-input-writer.js` |
| 71 | 3008 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/update-check.js` |
| 40 | 1596 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/url-validation.js` |
| 46 | 1853 | ОСТАВИТЬ — граница ответственности оправдана | `pages/batch/batch-capture-runner.js` |
| 86 | 4187 | ОСТАВИТЬ — граница ответственности оправдана | `pages/batch/batch-capture-utils.js` |
| 190 | 10810 | ОСТАВИТЬ — граница ответственности оправдана | `pages/batch/batch-main-run-controller.js` |
| 61 | 4038 | ОСТАВИТЬ — граница ответственности оправдана | `pages/batch/batch-operation-controller.js` |
| 184 | 10400 | ОСТАВИТЬ — граница ответственности оправдана | `pages/batch/batch-page-controller.js` |
| 216 | 10844 | ОСТАВИТЬ — граница ответственности оправдана | `pages/batch/batch-panel-loader.js` |
| 187 | 10190 | ОСТАВИТЬ — граница ответственности оправдана | `pages/batch/batch-panel-picker.js` |
| 78 | 7077 | ОСТАВИТЬ — граница ответственности оправдана | `pages/batch/batch-panel-rules-ui.js` |
| 39 | 1290 | ОСТАВИТЬ — граница ответственности оправдана | `pages/batch/batch-run-lifecycle.js` |
| 252 | 13433 | ОСТАВИТЬ — граница ответственности оправдана | `pages/batch/batch-series-discovery-controller.js` |
| 336 | 19242 | ОСТАВИТЬ — граница ответственности оправдана | `pages/batch/batch-series-run-controller.js` |
| 41 | 2030 | ОСТАВИТЬ — граница ответственности оправдана | `pages/batch/batch-series-selection.js` |
| 79 | 3524 | ОСТАВИТЬ — граница ответственности оправдана | `pages/batch/batch-state.js` |
| 111 | 4241 | ОСТАВИТЬ — граница ответственности оправдана | `pages/batch/batch.js` |
| 320 | 17347 | ОСТАВИТЬ — граница ответственности оправдана | `pages/dashbridge/dashbridge-capture.js` |
| 32 | 1217 | ОСТАВИТЬ — граница ответственности оправдана | `pages/dashbridge/dashbridge-crosshair.js` |
| 125 | 5762 | Оставить временно до подтверждённого rollout миграции | `pages/dashbridge/dashbridge-data-migration.js` |
| 145 | 6908 | ОСТАВИТЬ — граница ответственности оправдана | `pages/dashbridge/dashbridge-iframe-message-controller.js` |
| 98 | 4087 | ОСТАВИТЬ — граница ответственности оправдана | `pages/dashbridge/dashbridge-modal.js` |
| 184 | 10072 | ОСТАВИТЬ — граница ответственности оправдана | `pages/dashbridge/dashbridge-page-ui-controller.js` |
| 265 | 14088 | ОСТАВИТЬ — граница ответственности оправдана | `pages/dashbridge/dashbridge-panel-actions-controller.js` |
| 301 | 17172 | ОСТАВИТЬ — граница ответственности оправдана | `pages/dashbridge/dashbridge-panel-addition-controller.js` |
| 177 | 10097 | ОСТАВИТЬ — граница ответственности оправдана | `pages/dashbridge/dashbridge-panel-analysis-controller.js` |
| 263 | 12062 | ОСТАВИТЬ — граница ответственности оправдана | `pages/dashbridge/dashbridge-panel-card-controller.js` |
| 266 | 15931 | ОСТАВИТЬ — граница ответственности оправдана | `pages/dashbridge/dashbridge-panel-tools-controller.js` |
| 122 | 6437 | ОСТАВИТЬ — граница ответственности оправдана | `pages/dashbridge/dashbridge-panel-transfer-controller.js` |
| 105 | 4007 | ОСТАВИТЬ — граница ответственности оправдана | `pages/dashbridge/dashbridge-panel-transfer.js` |
| 88 | 3535 | ОСТАВИТЬ — граница ответственности оправдана | `pages/dashbridge/dashbridge-panel-url.js` |
| 203 | 12015 | ОСТАВИТЬ — граница ответственности оправдана | `pages/dashbridge/dashbridge-profile-controller.js` |
| 98 | 5608 | ОСТАВИТЬ — граница ответственности оправдана | `pages/dashbridge/dashbridge-renderer.js` |
| 219 | 13629 | ОСТАВИТЬ — граница ответственности оправдана | `pages/dashbridge/dashbridge-report-audit.js` |
| 177 | 10688 | ОСТАВИТЬ — граница ответственности оправдана | `pages/dashbridge/dashbridge-report-controller.js` |
| 257 | 17727 | ОСТАВИТЬ — граница ответственности оправдана | `pages/dashbridge/dashbridge-report-test-runner.js` |
| 202 | 9090 | ОСТАВИТЬ — граница ответственности оправдана | `pages/dashbridge/dashbridge-report-transport.js` |
| 386 | 34490 | ОСТАВИТЬ — граница ответственности оправдана | `pages/dashbridge/dashbridge-report-ui.js` |
| 315 | 16783 | ОСТАВИТЬ — граница ответственности оправдана | `pages/dashbridge/dashbridge-time-controller.js` |
| 51 | 2732 | ОСТАВИТЬ — граница ответственности оправдана | `pages/dashbridge/dashbridge-time-state.js` |
| 524 | 23237 | ОСТАВИТЬ — граница ответственности оправдана | `pages/dashbridge/dashbridge.js` |
| 184 | 9533 | ОСТАВИТЬ — граница ответственности оправдана | `pages/debug-easter-egg/debug-easter-egg.js` |
| 603 | 35843 | РАЗДЕЛИТЬ — settings UI и config import/export | `pages/options/options.js` |
| 131 | 5140 | ОСТАВИТЬ — граница ответственности оправдана | `pages/popup/popup-core.js` |
| 32 | 1524 | ОСТАВИТЬ — граница ответственности оправдана | `pages/popup/popup-debug-easter-egg.js` |
| 228 | 13605 | ОСТАВИТЬ — граница ответственности оправдана | `pages/popup/popup-grafana-debug.js` |
| 227 | 10793 | ОСТАВИТЬ — граница ответственности оправдана | `pages/popup/popup-grafana-links.js` |
| 124 | 5340 | ОСТАВИТЬ — граница ответственности оправдана | `pages/popup/popup-grafana-router.js` |
| 142 | 9298 | ОСТАВИТЬ — граница ответственности оправдана | `pages/popup/popup-jira.js` |
| 359 | 18021 | ОСТАВИТЬ — граница ответственности оправдана | `pages/popup/popup-tdm-page-export.js` |
| 235 | 11185 | ОСТАВИТЬ — граница ответственности оправдана | `pages/popup/popup-tdm.js` |
| 96 | 4108 | ОСТАВИТЬ — граница ответственности оправдана | `pages/popup/popup-updates.js` |
| 101 | 5386 | ОСТАВИТЬ — граница ответственности оправдана | `pages/recorder/recorder-action-capture.js` |
| 202 | 10433 | ОСТАВИТЬ — граница ответственности оправдана | `pages/recorder/recorder-dashflow-controller.js` |
| 184 | 9288 | ОСТАВИТЬ — граница ответственности оправдана | `pages/recorder/recorder-dashflow-export.js` |
| 211 | 10715 | ОСТАВИТЬ — граница ответственности оправдана | `pages/recorder/recorder-dashflow-io.js` |
| 419 | 21797 | ОСТАВИТЬ — граница ответственности оправдана | `pages/recorder/recorder-network-capture.js` |
| 230 | 16678 | ОСТАВИТЬ — граница ответственности оправдана | `pages/recorder/recorder-replay.js` |
| 154 | 7813 | ОСТАВИТЬ — граница ответственности оправдана | `pages/recorder/recorder-session-controller.js` |
| 184 | 7662 | ОСТАВИТЬ — граница ответственности оправдана | `pages/recorder/recorder-session-transport.js` |
| 65 | 2742 | ОСТАВИТЬ — граница ответственности оправдана | `pages/recorder/recorder-settings.js` |
| 334 | 22111 | ОСТАВИТЬ — граница ответственности оправдана | `pages/recorder/recorder-view.js` |
| 482 | 23492 | ОСТАВИТЬ — граница ответственности оправдана | `pages/recorder/recorder.js` |
| 162 | 9865 | ОСТАВИТЬ — граница ответственности оправдана | `pages/shared/operation-progress-window.js` |
| 167 | 8102 | ОСТАВИТЬ — граница ответственности оправдана | `pages/shared/theme.js` |
| 189 | 7643 | ОСТАВИТЬ — граница ответственности оправдана | `pages/test-runner/test-runner-artifact-serialization.js` |
| 958 | 45930 | ОСТАВИТЬ — единый state/lifecycle, no-growth budget | `pages/test-runner/test-runner-core.js` |
| 1279 | 66559 | РАЗДЕЛИТЬ — capture lifecycle и pure diagnostic diff | `pages/test-runner/test-runner-diagnostics.js` |
| 259 | 12844 | ОСТАВИТЬ — граница ответственности оправдана | `pages/test-runner/test-runner-probe.js` |
| 1167 | 72146 | ОСТАВИТЬ — единый state/lifecycle, no-growth budget | `pages/test-runner/test-runner-report.js` |
| 304 | 14855 | ОСТАВИТЬ — граница ответственности оправдана | `pages/test-runner/test-runner-spool.js` |
| 936 | 54917 | ОСТАВИТЬ — единый state/lifecycle, no-growth budget | `pages/test-runner/test-runner-suite.js` |
| 1104 | 59885 | ОСТАВИТЬ — единый state/lifecycle, no-growth budget | `pages/test-runner/test-runner-transitions.js` |
| 1253 | 67833 | РАЗДЕЛИТЬ — runner UI, diagnostic viewer и export | `pages/test-runner/test-runner-ui.js` |
| 139 | 7161 | ОСТАВИТЬ — граница ответственности оправдана | `pages/test-runner/test-selector.js` |
| 635 | 36802 | РАЗДЕЛИТЬ — page/render state и Jira transport | `pages/worklog/worklog.js` |

## Production HTML и CSS

| Строк | Байт | Решение | Файл |
|---:|---:|---|---|
| 930 | 18312 | РАЗДЕЛИТЬ — base/progress и panel/series workflows | `pages/batch/batch.css` |
| 318 | 20316 | ОСТАВИТЬ — composition root; фрагментация добавит runtime-загрузку | `pages/batch/batch.html` |
| 1625 | 47475 | РАЗДЕЛИТЬ — base/cards, dialogs/time picker, report/SLA | `pages/dashbridge/dashbridge.css` |
| 450 | 29476 | ОСТАВИТЬ — composition root; фрагментация добавит runtime-загрузку | `pages/dashbridge/dashbridge.html` |
| 29 | 2971 | ОСТАВИТЬ — область одной страницы/компонента | `pages/debug-easter-egg/debug-easter-egg.css` |
| 31 | 1502 | ОСТАВИТЬ — composition root; фрагментация добавит runtime-загрузку | `pages/debug-easter-egg/debug-easter-egg.html` |
| 340 | 8589 | ОСТАВИТЬ — область одной страницы/компонента | `pages/options/options.css` |
| 476 | 30262 | ОСТАВИТЬ — composition root; фрагментация добавит runtime-загрузку | `pages/options/options.html` |
| 728 | 19264 | ОСТАВИТЬ — область одной страницы/компонента | `pages/popup/popup.css` |
| 436 | 27288 | ОСТАВИТЬ — composition root; фрагментация добавит runtime-загрузку | `pages/popup/popup.html` |
| 155 | 13647 | ОСТАВИТЬ — область одной страницы/компонента | `pages/recorder/recorder.css` |
| 178 | 10984 | ОСТАВИТЬ — composition root; фрагментация добавит runtime-загрузку | `pages/recorder/recorder.html` |
| 112 | 2446 | ОСТАВИТЬ — область одной страницы/компонента | `pages/shared/operation-progress.css` |
| 1644 | 39753 | РАЗДЕЛИТЬ — shared tokens/components; page-specific overrides перенести к страницам | `pages/shared/theme.css` |
| 291 | 8628 | ОСТАВИТЬ — область одной страницы/компонента | `pages/test-runner/test-runner.css` |
| 680 | 21871 | ОСТАВИТЬ — composition root; фрагментация добавит runtime-загрузку | `pages/test-runner/test-runner.html` |
| 36 | 3742 | ОСТАВИТЬ — область одной страницы/компонента | `pages/test-runner/test-selector.css` |
| 42 | 1885 | ОСТАВИТЬ — composition root; фрагментация добавит runtime-загрузку | `pages/test-runner/test-selector.html` |
| 655 | 16395 | ОСТАВИТЬ — область одной страницы/компонента | `pages/worklog/worklog.css` |
| 96 | 4922 | ОСТАВИТЬ — composition root; фрагментация добавит runtime-загрузку | `pages/worklog/worklog.html` |
## Тесты и fixtures

| Строк | Байт | Решение | Файл |
|---:|---:|---|---|
| 4 | 171 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/fixtures/grafana-frame.html` |
| 10 | 366 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/fixtures/grafana-panel-viz-key.html` |
| 10 | 310 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/fixtures/grafana-panel.html` |
| 93 | 3543 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/analyze_e2e_diagnostics_layout.js` |
| 405 | 17771 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/analyze_e2e_diagnostics_slice.js` |
| 73 | 2657 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/analyze_e2e_diagnostics_summary.js` |
| 77 | 2979 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/analyze_e2e_diagnostics_test_size.js` |
| 47 | 2882 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/archive_budget_behavior.js` |
| 133 | 5528 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/audit_theme_overrides.py` |
| 262 | 11388 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/audit_theme_quality.py` |
| 610 | 32296 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/audit_ui_theme.py` |
| 102 | 6361 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/background_gui_capture_behavior.js` |
| 66 | 3746 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/batch_capture_utils_behavior.js` |
| 47 | 2709 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/batch_dashboard_picker_behavior.js` |
| 93 | 3883 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/batch_main_run_controller_behavior.js` |
| 163 | 6412 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/batch_page_controller_behavior.js` |
| 88 | 3664 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/batch_panel_capture_context_behavior.js` |
| 55 | 2336 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/batch_panel_rules_behavior.js` |
| 25 | 1028 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/batch_run_lifecycle_behavior.js` |
| 111 | 4250 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/batch_series_discovery_controller_behavior.js` |
| 191 | 7746 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/batch_series_run_controller_behavior.js` |
| 69 | 2622 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/batch_series_selection_behavior.js` |
| 46 | 2315 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/batch_state_restore_behavior.js` |
| 27 | 1068 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/bounded_journal_behavior.js` |
| 79 | 3280 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/confluence_bridge_behavior.js` |
| 112 | 3699 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/confluence_focus_lifecycle_behavior.js` |
| 208 | 11488 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/controller_split_behavior.js` |
| 152 | 10312 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_auto_refresh_behavior.js` |
| 32 | 1757 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_capture_module_behavior.js` |
| 56 | 3601 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_dashboard_picker_behavior.js` |
| 100 | 4307 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_data_migration_behavior.js` |
| 103 | 4955 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_iframe_message_controller_behavior.js` |
| 118 | 4487 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_modal_behavior.js` |
| 144 | 5981 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_page_ui_controller_behavior.js` |
| 132 | 5201 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_panel_actions_controller_behavior.js` |
| 119 | 5052 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_panel_addition_controller_behavior.js` |
| 97 | 4903 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_panel_analysis_controller_behavior.js` |
| 156 | 6477 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_panel_card_controller_behavior.js` |
| 119 | 5873 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_panel_tools_controller_behavior.js` |
| 118 | 5653 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_panel_transfer_behavior.js` |
| 146 | 6094 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_panel_transfer_controller_behavior.js` |
| 95 | 5226 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_panel_url_behavior.js` |
| 64 | 2839 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_profile_concurrency_behavior.js` |
| 63 | 3046 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_profile_store_behavior.js` |
| 76 | 4155 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_renderer_safety_behavior.js` |
| 74 | 4585 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_report_audit_behavior.js` |
| 74 | 4550 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_report_behavior.js` |
| 87 | 4229 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_report_controller_behavior.js` |
| 214 | 16350 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_report_integration_behavior.js` |
| 35 | 2021 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_report_schema_behavior.js` |
| 59 | 3365 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_report_test_runner_behavior.js` |
| 147 | 5469 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_report_transport_behavior.js` |
| 154 | 7601 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_report_ui_behavior.js` |
| 90 | 3428 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_report_variable_contract_behavior.js` |
| 23 | 1397 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_tab_profile_behavior.js` |
| 142 | 7083 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_time_controller_behavior.js` |
| 51 | 2216 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_time_state_behavior.js` |
| 51 | 3045 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashflow_compare_behavior.js` |
| 129 | 5337 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashflow_export_behavior.js` |
| 150 | 6748 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashflow_io_behavior.js` |
| 245 | 23123 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashflow_recorder_behavior.js` |
| 50 | 3471 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashflow_xlsx_behavior.js` |
| 46 | 2281 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dependency_contracts_behavior.js` |
| 201 | 9574 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/devtools-e2e-idempotence-diagnostics.js` |
| 74 | 4184 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/devtools-e2e-panel-diagnostics.js` |
| 100 | 4921 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/devtools-e2e-visual-diagnostics.js` |
| 27 | 1509 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dnr_session_rules_behavior.js` |
| 83 | 4414 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/extension_package_integrity_behavior.js` |
| 52 | 2388 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_calculated_title_behavior.js` |
| 127 | 10102 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_capture_layout_behavior.js` |
| 62 | 2052 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_compact_layout_behavior.js` |
| 40 | 1597 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_complete_hide_url_behavior.js` |
| 265 | 14010 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_cpu_capacity_filter_behavior.js` |
| 40 | 2010 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_dashboard_api_behavior.js` |
| 57 | 2841 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_dashbridge_transform_bootstrap_behavior.js` |
| 40 | 1442 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_e2e_profile_behavior.js` |
| 72 | 2746 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_flot_response_filter_remount_behavior.js` |
| 32 | 1431 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_legend_visuals_module_behavior.js` |
| 98 | 4701 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_mem_conversion_atomic_behavior.js` |
| 56 | 2198 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_memory_unit_restore_behavior.js` |
| 72 | 3264 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_metric_keyword_literal_behavior.js` |
| 61 | 4229 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_network_behavior.js` |
| 317 | 18247 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_panel_analysis_behavior.js` |
| 53 | 1935 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_panel_data_runtime_behavior.js` |
| 132 | 6481 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_panel_definition_behavior.js` |
| 65 | 3690 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_panel_feature_scope_behavior.js` |
| 21 | 1421 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_panel_identity_behavior.js` |
| 55 | 2082 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_panel_menu_runtime_behavior.js` |
| 98 | 3949 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_panel_scoped_refresh_behavior.js` |
| 46 | 1742 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_panel_state_page_behavior.js` |
| 160 | 11639 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_panel_tools_persistence_behavior.js` |
| 78 | 3829 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_refresh_policy_behavior.js` |
| 57 | 3588 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_report_legend_names_behavior.js` |
| 49 | 2523 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_report_response_capture_behavior.js` |
| 43 | 1719 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_report_snapshot_module_behavior.js` |
| 40 | 1803 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_response_filter_exclusivity_behavior.js` |
| 49 | 2471 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_response_filter_workspace_behavior.js` |
| 39 | 3666 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_runtime_manifest_behavior.js` |
| 36 | 1618 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_runtime_registration_behavior.js` |
| 54 | 2497 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_series_capture_behavior.js` |
| 203 | 7998 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_series_query_filter_behavior.js` |
| 50 | 1966 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_series_styles_module_behavior.js` |
| 61 | 4157 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_settings_behavior.js` |
| 67 | 3787 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_table_report_behavior.js` |
| 36 | 1587 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_threshold_highlight_flot_offset_behavior.js` |
| 36 | 1358 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_threshold_highlight_interpolation_behavior.js` |
| 83 | 5222 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_threshold_highlight_remount_behavior.js` |
| 174 | 8848 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_threshold_highlight_toggle_behavior.js` |
| 45 | 1907 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_threshold_highlight_uplot_offset_behavior.js` |
| 59 | 3335 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_threshold_highlight_width_behavior.js` |
| 22 | 1129 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_threshold_layout_cleanup_behavior.js` |
| 53 | 2053 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_threshold_visuals_module_behavior.js` |
| 54 | 2978 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_time_picker_clipboard_behavior.js` |
| 27 | 1122 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_time_ranges_behavior.js` |
| 45 | 2292 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_timestamp_clipboard_behavior.js` |
| 75 | 4124 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_unit_behavior.js` |
| 168 | 9622 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_vcpu_legend_behavior.js` |
| 73 | 4369 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/installer_behavior.js` |
| 88 | 3860 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/jira_transfer_safety_behavior.js` |
| 52 | 3294 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/legend_complete_hide_behavior.js` |
| 29 | 1012 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/legend_selection_patterns_behavior.js` |
| 79 | 3842 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/live_grafana_e2e_runner_behavior.js` |
| 76 | 4845 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/local_state_schema_behavior.js` |
| 86 | 4919 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/operation_progress_window_behavior.js` |
| 113 | 6946 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/options_user_settings_behavior.js` |
| 94 | 6759 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/panel_settings_external_text_behavior.js` |
| 132 | 8888 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/popup_initial_layout_behavior.js` |
| 36 | 1930 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/popup_update_notice_behavior.js` |
| 20 | 745 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/README.md` |
| 50 | 1932 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/recorder_action_capture_behavior.js` |
| 164 | 6398 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/recorder_dashflow_controller_behavior.js` |
| 189 | 7657 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/recorder_network_capture_behavior.js` |
| 155 | 5923 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/recorder_session_controller_behavior.js` |
| 152 | 5226 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/recorder_session_transport_behavior.js` |
| 54 | 1892 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/recorder_settings_behavior.js` |
| 33 | 2057 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/recorder_view_module_behavior.js` |
| 56 | 2818 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/release_workflow_behavior.js` |
| 108 | 7304 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/responsive_layout_behavior.js` |
| 26 | 1041 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/run-all-tests.js` |
| 270 | 10971 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/run-extension-browser-smoke.js` |
| 36 | 1310 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/run-js-tests.js` |
| 65 | 2375 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/run-python-smoke-tests.js` |
| 25 | 696 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/security_tdm_domain_guard.py` |
| 17 | 1462 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_architecture_contracts.py` |
| 78 | 5925 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_batch_audit_regressions.py` |
| 47 | 2979 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_batch_capture.py` |
| 39 | 2860 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_batch_panel_rules.py` |
| 35 | 2237 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_batch_theme.py` |
| 108 | 9032 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_batch_worklog_workflows.py` |
| 16 | 780 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_confluence_content.py` |
| 32 | 2031 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_crosshair_sync.py` |
| 558 | 23543 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_dashbridge_core.py` |
| 29 | 1738 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_dashbridge_drag_drop.py` |
| 27 | 1243 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_dashbridge_iframe_theme.py` |
| 56 | 3299 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_dashbridge_lazy_iframes.py` |
| 37 | 2570 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_dashbridge_paused_snapshots.py` |
| 64 | 5327 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_dashbridge_profiles_time.py` |
| 59 | 3962 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_debug_easter_egg.py` |
| 48 | 2349 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_extension_wiring.py` |
| 89 | 3809 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_grafana_dom_compatibility.py` |
| 41 | 3228 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_grafana_iframe_rules.py` |
| 25 | 1112 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_grafana_legend_filter_scenarios.py` |
| 41 | 2779 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_grafana_legend_filter.py` |
| 33 | 2206 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_grafana_legend_visuals.py` |
| 22 | 1386 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_grafana_line_width.py` |
| 435 | 38020 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_grafana_panel_tools.py` |
| 66 | 3597 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_grafana_save_to_profile.py` |
| 48 | 1817 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_grafana_time_formats.py` |
| 27 | 1400 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_gui_capture_ready.py` |
| 73 | 6900 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_lifecycle_contracts.py` |
| 52 | 3209 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_options.py` |
| 103 | 4694 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_popup_contracts.py` |
| 73 | 4156 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_popup_grafana_screenshot.py` |
| 35 | 2251 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_postmessage_origins.py` |
| 26 | 1305 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_resource_lifecycle.py` |
| 430 | 27411 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_test_runner_matrix.py` |
| 31 | 1432 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_theme_runtime.py` |
| 32 | 1292 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_theme_tokens.py` |
| 69 | 3287 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_visual_style_contract.py` |
| 18 | 651 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_worklog.py` |
| 60 | 3022 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/storage_writer_behavior.js` |
| 2 | 59 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/support/__init__.py` |
| 158 | 4396 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/support/smoke.py` |
| 41 | 1523 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/sync_input_writer_behavior.js` |
| 23 | 1654 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/tdm_export_lifecycle_behavior.js` |
| 79 | 4001 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/test_runner_chunked_export_behavior.js` |
| 122 | 6503 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/test_runner_disk_spool_behavior.js` |
| 183 | 8250 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/test_runner_generator_behavior.js` |
| 19 | 823 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/test_runner_layout_behavior.js` |
| 36 | 1432 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/test_runner_probe_behavior.js` |
| 344 | 21432 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/test_runner_report_artifact_behavior.js` |
| 55 | 2066 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/test_runner_reporting_behavior.js` |
| 91 | 6333 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/test_runner_selection_behavior.js` |
| 71 | 4325 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/test_runner_visual_reuse_behavior.js` |
| 28 | 1619 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/test_suite_structure_behavior.js` |
| 51 | 2165 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/theme_runtime_behavior.js` |
| 51 | 2281 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/update_check_behavior.js` |
| 22 | 1092 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/url_validation_behavior.js` |
| 29 | 1345 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/worklog_regressions_behavior.js` |

## Dev/release scripts

| Строк | Байт | Решение | Файл |
|---:|---:|---|---|
| 43 | 1171 | ОСТАВИТЬ — отдельный dev/release lifecycle | `.github/workflows/release.yml` |
| 122 | 5170 | ОСТАВИТЬ — отдельный dev/release lifecycle | `scripts/build-release.ps1` |
| 309 | 15496 | ОСТАВИТЬ — отдельный dev/release lifecycle | `scripts/check-dependency-contracts.js` |
| 45 | 1726 | ОСТАВИТЬ — отдельный dev/release lifecycle | `scripts/check-documentation-links.js` |
| 87 | 3438 | ОСТАВИТЬ — отдельный dev/release lifecycle | `scripts/check-grafana-e2e-session.js` |
| 64 | 2336 | ОСТАВИТЬ — отдельный dev/release lifecycle | `scripts/check-module-boundaries.js` |
| 508 | 27031 | ОСТАВИТЬ — отдельный dev/release lifecycle | `scripts/Install-DashBridge.ps1` |
| 59 | 2195 | ОСТАВИТЬ — отдельный dev/release lifecycle | `scripts/module-size-budgets.json` |
| 382 | 17659 | ОСТАВИТЬ — отдельный dev/release lifecycle | `scripts/run-live-grafana-e2e.js` |
| 114 | 4500 | ОСТАВИТЬ — отдельный dev/release lifecycle | `scripts/setup-grafana-e2e-profile.js` |

## Документация

| Строк | Байт | Решение | Файл |
|---:|---:|---|---|
| 117 | 7891 | ОСТАВИТЬ — самостоятельный документ | `AGENTS.md` |
| 804 | 70821 | ОСТАВИТЬ — самостоятельный документ | `docs/architecture.md` |
| 126 | 9654 | ОСТАВИТЬ — самостоятельный документ | `docs/dashflow-v2.md` |
| 283 | 21737 | ОСТАВИТЬ — самостоятельный документ | `docs/development-guide.md` |
| 51 | 3573 | ОСТАВИТЬ — самостоятельный документ | `docs/history/architecture-decisions.md` |
| 12 | 884 | ОСТАВИТЬ — самостоятельный документ | `docs/history/legacy-global-dnr-rule.md` |
| 90 | 7282 | ОСТАВИТЬ — самостоятельный документ | `docs/installer.md` |
| 201 | 12756 | ОСТАВИТЬ — самостоятельный документ | `docs/module-design.md` |
| 37 | 4341 | ОСТАВИТЬ — самостоятельный документ | `docs/permission-map.md` |
| 277 | 11194 | ОСТАВИТЬ — самостоятельный документ | `docs/prototypes/grafana-axis-density.md` |
| 51 | 3862 | ОСТАВИТЬ — самостоятельный документ | `docs/README.md` |
| 79 | 5764 | ОСТАВИТЬ — самостоятельный документ | `docs/roadmap.md` |
| 345 | 25737 | ОСТАВИТЬ — самостоятельный документ | `README.md` |

## Конфигурация, assets и vendor

| Строк | Байт | Решение | Файл |
|---:|---:|---|---|
| 19 | 519 | ОСТАВИТЬ — единый config/schema | `.gitignore` |
| 184 | 9190 | ОСТАВИТЬ | `eslint.config.js` |
| 7 | 523 | ОСТАВИТЬ — asset | `icons/dashbridge-mark.svg` |
| — | 1577 | ОСТАВИТЬ — asset | `icons/icon128.png` |
| — | 340 | ОСТАВИТЬ — asset | `icons/icon16.png` |
| — | 1075 | ОСТАВИТЬ — asset | `icons/icon48.png` |
| 81 | 2210 | ОСТАВИТЬ — единый config/schema | `manifest.json` |
| 949 | 33122 | Generated lock: не делить и не редактировать вручную | `package-lock.json` |
| 24 | 799 | ОСТАВИТЬ — единый config/schema | `package.json` |
| 1 | 37744 | ОСТАВИТЬ | `pages/debug-easter-egg/assets/cache-01.txt` |
| 1 | 87272 | ОСТАВИТЬ | `pages/debug-easter-egg/assets/cache-02.txt` |
| 1 | 46652 | ОСТАВИТЬ | `pages/debug-easter-egg/assets/cache-03.txt` |
| 1 | 69124 | ОСТАВИТЬ | `pages/debug-easter-egg/assets/cache-04.txt` |
| 1 | 57792 | ОСТАВИТЬ | `pages/debug-easter-egg/assets/cache-05.txt` |
| 1 | 65608 | ОСТАВИТЬ | `pages/debug-easter-egg/assets/cache-06.txt` |
| 1 | 78700 | ОСТАВИТЬ | `pages/debug-easter-egg/assets/cache-07.txt` |
| 1 | 51236 | ОСТАВИТЬ | `pages/debug-easter-egg/assets/cache-08.txt` |
| 1 | 94684 | ОСТАВИТЬ | `pages/debug-easter-egg/assets/cache-09.txt` |
| 13 | 97630 | Сторонний minified vendor: не изменять | `vendor/jszip.min.js` |

## Порядок безопасной реализации

Каждый пункт выполняется отдельным коммитом. Перед переносом: architecture/module-design, точный поиск globals/actions/storage/selectors, dependency guard `--explain`, targeted tests. После: module budget, dependency guard, ESLint, полный Node/Python runner и browser smoke. CSS требует визуальных проверок всех тем и размеров; Grafana MAIN в этом плане не меняется.
