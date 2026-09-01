# Аудит размеров и границ файлов DashBridge

Дата: 2026-09-01. Ветка/версия анализа: итоговый main после коммита `fe77bfa`.

## Область и критерии

Проверены 408 tracked-файлов вне самого отчёта. Игнорируемые `node_modules/`, `dist/`, `test-results/` и индекс GitNexus не входят в аудит. Для бинарных assets количество строк неприменимо. Канонический production-контур содержит 139 JavaScript-модулей.

Решение основано не только на размере: учитывались context/trust boundary, владелец mutable state, lifecycle/cleanup, потребители, script order и самостоятельность тестирования. Цель 300–500 строк и предел 700 строк применяются к новому handwritten production JS; существующий крупный единый state machine не делится механически.

## Итог

- Разделить сейчас: 0 файлов — все семь подтверждённых границ реализованы.
- Объединить: 0 файлов. После удаления искусственного `grafana-panel-tools-bridge.js` новых proxy-пар не найдено.
- Оставить под документированным no-growth budget: 10 крупных единых state/lifecycle-модулей.
- Остальные файлы оставить в текущих границах.

### Выполненное разделение

1. `pages/options/options.js` — config transfer вынесен в `options-config-transfer.js`.
2. `pages/worklog/worklog.js` — Jira transport вынесен в `worklog-jira-client.js`.
3. `pages/shared/theme.css` — shared tokens/components отделены от `theme-compat.css`, Options-стили принадлежат странице.
4. `pages/dashbridge/dashbridge.css` — отделены dialogs, interactions/time и report/SLA.
5. `pages/batch/batch.css` — panel/series workflow вынесен в `batch-workflow.css`.
6. `pages/test-runner/test-runner-diagnostics.js` — чистый diff вынесен в `test-runner-diagnostic-diff.js`.
7. `pages/test-runner/test-runner-ui.js` — diagnostic viewer и export/clipboard получили самостоятельные контроллеры.

Test Runner выполнен последним; итоговые границы подтверждены полным contract-run и browser smoke.

## Production JavaScript

| Строк | Байт | Решение | Файл |
|---:|---:|---|---|
| 171 | 9150 | ОСТАВИТЬ — граница ответственности оправдана | `js/background-grafana-infrastructure.js` |
| 180 | 9561 | ОСТАВИТЬ — граница ответственности оправдана | `js/background-gui-capture.js` |
| 158 | 9258 | ОСТАВИТЬ — граница ответственности оправдана | `js/background-profile-storage.js` |
| 167 | 9168 | ОСТАВИТЬ — граница ответственности оправдана | `js/background.js` |
| 296 | 20533 | ОСТАВИТЬ — граница ответственности оправдана | `js/content/content.js` |
| 132 | 7086 | ОСТАВИТЬ — граница ответственности оправдана | `js/content/grafana-compact-layout.js` |
| 385 | 18434 | ОСТАВИТЬ — граница ответственности оправдана | `js/content/grafana-cpu-capacity-filter.js` |
| 313 | 16262 | ОСТАВИТЬ — граница ответственности оправдана | `js/content/grafana-cpu-capacity-legend.js` |
| 96 | 5630 | ОСТАВИТЬ — граница ответственности оправдана | `js/content/grafana-dom.js` |
| 348 | 15993 | ОСТАВИТЬ — граница ответственности оправдана | `js/content/grafana-iframe.js` |
| 564 | 28139 | ОСТАВИТЬ — граница ответственности оправдана | `js/content/grafana-legend-visibility-adapters.js` |
| 984 | 60556 | ОСТАВИТЬ — единый state/lifecycle, no-growth budget | `js/content/grafana-legend-visuals.js` |
| 34 | 1518 | ОСТАВИТЬ — граница ответственности оправдана | `js/content/grafana-network.js` |
| 498 | 31942 | ОСТАВИТЬ — граница ответственности оправдана | `js/content/grafana-panel-capture-runtime.js` |
| 710 | 45436 | ОСТАВИТЬ — единый state/lifecycle, no-growth budget | `js/content/grafana-panel-data-runtime.js` |
| 548 | 32368 | ОСТАВИТЬ — граница ответственности оправдана | `js/content/grafana-panel-data-transforms.js` |
| 165 | 9176 | ОСТАВИТЬ — граница ответственности оправдана | `js/content/grafana-panel-definition.js` |
| 591 | 42532 | ОСТАВИТЬ — граница ответственности оправдана | `js/content/grafana-panel-menu-runtime.js` |
| 28 | 1041 | ОСТАВИТЬ — граница ответственности оправдана | `js/content/grafana-panel-state.js` |
| 2286 | 131168 | ОСТАВИТЬ — единый state/lifecycle, no-growth budget | `js/content/grafana-panel-tools.js` |
| 70 | 2917 | ОСТАВИТЬ — граница ответственности оправдана | `js/content/grafana-refresh-policy.js` |
| 263 | 17240 | ОСТАВИТЬ — граница ответственности оправдана | `js/content/grafana-report-snapshot.js` |
| 84 | 4588 | ОСТАВИТЬ — граница ответственности оправдана | `js/content/grafana-series-capture.js` |
| 241 | 13162 | ОСТАВИТЬ — граница ответственности оправдана | `js/content/grafana-series-styles.js` |
| 84 | 5324 | ОСТАВИТЬ — граница ответственности оправдана | `js/content/grafana-table-report.js` |
| 771 | 44496 | ОСТАВИТЬ — единый state/lifecycle, no-growth budget | `js/content/grafana-threshold-visuals.js` |
| 213 | 11570 | ОСТАВИТЬ — граница ответственности оправдана | `js/content/grafana-time-picker-clipboard.js` |
| 111 | 4353 | ОСТАВИТЬ — граница ответственности оправдана | `js/content/grafana-unit.js` |
| 230 | 11087 | ОСТАВИТЬ — граница ответственности оправдана | `js/content/grafana-visual-engine.js` |
| 89 | 3440 | ОСТАВИТЬ — граница ответственности оправдана | `js/content/inject.js` |
| 173 | 7893 | ОСТАВИТЬ — граница ответственности оправдана | `js/content/scenario-recorder.js` |
| 16 | 781 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/archive-budget.js` |
| 51 | 2351 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/archive-download.js` |
| 50 | 1927 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/bounded-journal.js` |
| 71 | 3836 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/dashbridge-profile-store.js` |
| 240 | 14208 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/dashbridge-report.js` |
| 61 | 3008 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/dashflow-compare.js` |
| 200 | 11253 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/dashflow-schema.js` |
| 177 | 16591 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/dashflow-xlsx.js` |
| 40 | 1993 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/dnr-rules.js` |
| 66 | 2906 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/grafana-batch-panel-rules.js` |
| 69 | 3961 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/grafana-capture-output.js` |
| 42 | 2654 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/grafana-command.js` |
| 106 | 4463 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/grafana-dashboard-api.js` |
| 53 | 2955 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/grafana-legend-engine.js` |
| 59 | 2845 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/grafana-legend-selection.js` |
| 376 | 21322 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/grafana-panel-analysis.js` |
| 105 | 4503 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/grafana-panel-bootstrap.js` |
| 127 | 7206 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/grafana-panel-capture.js` |
| 32 | 1473 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/grafana-panel-identity.js` |
| 411 | 52782 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/grafana-panel-settings-modal.js` |
| 45 | 2161 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/grafana-runtime-manifest.js` |
| 58 | 2983 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/grafana-runtime.js` |
| 73 | 3927 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/grafana-settings.js` |
| 49 | 1976 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/grafana-time.js` |
| 126 | 5764 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/grafana-url.js` |
| 340 | 20168 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/local-state-schema.js` |
| 87 | 3861 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/storage-writer.js` |
| 59 | 2311 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/sync-input-writer.js` |
| 70 | 3008 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/update-check.js` |
| 39 | 1596 | ОСТАВИТЬ — граница ответственности оправдана | `js/shared/url-validation.js` |
| 45 | 1853 | ОСТАВИТЬ — граница ответственности оправдана | `pages/batch/batch-capture-runner.js` |
| 85 | 4187 | ОСТАВИТЬ — граница ответственности оправдана | `pages/batch/batch-capture-utils.js` |
| 189 | 10810 | ОСТАВИТЬ — граница ответственности оправдана | `pages/batch/batch-main-run-controller.js` |
| 60 | 4038 | ОСТАВИТЬ — граница ответственности оправдана | `pages/batch/batch-operation-controller.js` |
| 183 | 10400 | ОСТАВИТЬ — граница ответственности оправдана | `pages/batch/batch-page-controller.js` |
| 215 | 10844 | ОСТАВИТЬ — граница ответственности оправдана | `pages/batch/batch-panel-loader.js` |
| 186 | 10190 | ОСТАВИТЬ — граница ответственности оправдана | `pages/batch/batch-panel-picker.js` |
| 77 | 7077 | ОСТАВИТЬ — граница ответственности оправдана | `pages/batch/batch-panel-rules-ui.js` |
| 38 | 1290 | ОСТАВИТЬ — граница ответственности оправдана | `pages/batch/batch-run-lifecycle.js` |
| 251 | 13433 | ОСТАВИТЬ — граница ответственности оправдана | `pages/batch/batch-series-discovery-controller.js` |
| 335 | 19242 | ОСТАВИТЬ — граница ответственности оправдана | `pages/batch/batch-series-run-controller.js` |
| 40 | 2030 | ОСТАВИТЬ — граница ответственности оправдана | `pages/batch/batch-series-selection.js` |
| 78 | 3524 | ОСТАВИТЬ — граница ответственности оправдана | `pages/batch/batch-state.js` |
| 110 | 4241 | ОСТАВИТЬ — граница ответственности оправдана | `pages/batch/batch.js` |
| 319 | 17347 | ОСТАВИТЬ — граница ответственности оправдана | `pages/dashbridge/dashbridge-capture.js` |
| 31 | 1217 | ОСТАВИТЬ — граница ответственности оправдана | `pages/dashbridge/dashbridge-crosshair.js` |
| 124 | 5762 | Оставить временно до подтверждённого rollout миграции | `pages/dashbridge/dashbridge-data-migration.js` |
| 144 | 6908 | ОСТАВИТЬ — граница ответственности оправдана | `pages/dashbridge/dashbridge-iframe-message-controller.js` |
| 97 | 4087 | ОСТАВИТЬ — граница ответственности оправдана | `pages/dashbridge/dashbridge-modal.js` |
| 183 | 10072 | ОСТАВИТЬ — граница ответственности оправдана | `pages/dashbridge/dashbridge-page-ui-controller.js` |
| 264 | 14088 | ОСТАВИТЬ — граница ответственности оправдана | `pages/dashbridge/dashbridge-panel-actions-controller.js` |
| 300 | 17172 | ОСТАВИТЬ — граница ответственности оправдана | `pages/dashbridge/dashbridge-panel-addition-controller.js` |
| 176 | 10097 | ОСТАВИТЬ — граница ответственности оправдана | `pages/dashbridge/dashbridge-panel-analysis-controller.js` |
| 262 | 12062 | ОСТАВИТЬ — граница ответственности оправдана | `pages/dashbridge/dashbridge-panel-card-controller.js` |
| 265 | 15931 | ОСТАВИТЬ — граница ответственности оправдана | `pages/dashbridge/dashbridge-panel-tools-controller.js` |
| 121 | 6437 | ОСТАВИТЬ — граница ответственности оправдана | `pages/dashbridge/dashbridge-panel-transfer-controller.js` |
| 104 | 4007 | ОСТАВИТЬ — граница ответственности оправдана | `pages/dashbridge/dashbridge-panel-transfer.js` |
| 87 | 3535 | ОСТАВИТЬ — граница ответственности оправдана | `pages/dashbridge/dashbridge-panel-url.js` |
| 202 | 12015 | ОСТАВИТЬ — граница ответственности оправдана | `pages/dashbridge/dashbridge-profile-controller.js` |
| 97 | 5608 | ОСТАВИТЬ — граница ответственности оправдана | `pages/dashbridge/dashbridge-renderer.js` |
| 218 | 13629 | ОСТАВИТЬ — граница ответственности оправдана | `pages/dashbridge/dashbridge-report-audit.js` |
| 176 | 10688 | ОСТАВИТЬ — граница ответственности оправдана | `pages/dashbridge/dashbridge-report-controller.js` |
| 256 | 17727 | ОСТАВИТЬ — граница ответственности оправдана | `pages/dashbridge/dashbridge-report-test-runner.js` |
| 201 | 9090 | ОСТАВИТЬ — граница ответственности оправдана | `pages/dashbridge/dashbridge-report-transport.js` |
| 385 | 34490 | ОСТАВИТЬ — граница ответственности оправдана | `pages/dashbridge/dashbridge-report-ui.js` |
| 314 | 16783 | ОСТАВИТЬ — граница ответственности оправдана | `pages/dashbridge/dashbridge-time-controller.js` |
| 50 | 2732 | ОСТАВИТЬ — граница ответственности оправдана | `pages/dashbridge/dashbridge-time-state.js` |
| 523 | 23237 | ОСТАВИТЬ — граница ответственности оправдана | `pages/dashbridge/dashbridge.js` |
| 183 | 9533 | ОСТАВИТЬ — граница ответственности оправдана | `pages/debug-easter-egg/debug-easter-egg.js` |
| 231 | 14922 | ОСТАВИТЬ — самостоятельный config transfer lifecycle | `pages/options/options-config-transfer.js` |
| 380 | 22536 | ОСТАВИТЬ — settings page state; config transfer вынесен | `pages/options/options.js` |
| 130 | 5140 | ОСТАВИТЬ — граница ответственности оправдана | `pages/popup/popup-core.js` |
| 31 | 1524 | ОСТАВИТЬ — граница ответственности оправдана | `pages/popup/popup-debug-easter-egg.js` |
| 227 | 13605 | ОСТАВИТЬ — граница ответственности оправдана | `pages/popup/popup-grafana-debug.js` |
| 226 | 10793 | ОСТАВИТЬ — граница ответственности оправдана | `pages/popup/popup-grafana-links.js` |
| 123 | 5340 | ОСТАВИТЬ — граница ответственности оправдана | `pages/popup/popup-grafana-router.js` |
| 141 | 9298 | ОСТАВИТЬ — граница ответственности оправдана | `pages/popup/popup-jira.js` |
| 358 | 18021 | ОСТАВИТЬ — граница ответственности оправдана | `pages/popup/popup-tdm-page-export.js` |
| 234 | 11185 | ОСТАВИТЬ — граница ответственности оправдана | `pages/popup/popup-tdm.js` |
| 95 | 4108 | ОСТАВИТЬ — граница ответственности оправдана | `pages/popup/popup-updates.js` |
| 100 | 5386 | ОСТАВИТЬ — граница ответственности оправдана | `pages/recorder/recorder-action-capture.js` |
| 201 | 10433 | ОСТАВИТЬ — граница ответственности оправдана | `pages/recorder/recorder-dashflow-controller.js` |
| 183 | 9288 | ОСТАВИТЬ — граница ответственности оправдана | `pages/recorder/recorder-dashflow-export.js` |
| 210 | 10715 | ОСТАВИТЬ — граница ответственности оправдана | `pages/recorder/recorder-dashflow-io.js` |
| 418 | 21797 | ОСТАВИТЬ — граница ответственности оправдана | `pages/recorder/recorder-network-capture.js` |
| 229 | 16678 | ОСТАВИТЬ — граница ответственности оправдана | `pages/recorder/recorder-replay.js` |
| 153 | 7813 | ОСТАВИТЬ — граница ответственности оправдана | `pages/recorder/recorder-session-controller.js` |
| 183 | 7662 | ОСТАВИТЬ — граница ответственности оправдана | `pages/recorder/recorder-session-transport.js` |
| 64 | 2742 | ОСТАВИТЬ — граница ответственности оправдана | `pages/recorder/recorder-settings.js` |
| 333 | 22111 | ОСТАВИТЬ — граница ответственности оправдана | `pages/recorder/recorder-view.js` |
| 481 | 23492 | ОСТАВИТЬ — граница ответственности оправдана | `pages/recorder/recorder.js` |
| 161 | 9865 | ОСТАВИТЬ — граница ответственности оправдана | `pages/shared/operation-progress-window.js` |
| 166 | 8102 | ОСТАВИТЬ — граница ответственности оправдана | `pages/shared/theme.js` |
| 188 | 7643 | ОСТАВИТЬ — граница ответственности оправдана | `pages/test-runner/test-runner-artifact-serialization.js` |
| 957 | 45930 | ОСТАВИТЬ — единый state/lifecycle, no-growth budget | `pages/test-runner/test-runner-core.js` |
| 154 | 7262 | ОСТАВИТЬ — чистый bounded runtime snapshot diff | `pages/test-runner/test-runner-diagnostic-diff.js` |
| 380 | 25791 | ОСТАВИТЬ — diagnostic popup/theme/Blob lifecycle | `pages/test-runner/test-runner-diagnostic-viewer.js` |
| 1126 | 59312 | ОСТАВИТЬ — единый capture lifecycle, no-growth budget; pure diff вынесен | `pages/test-runner/test-runner-diagnostics.js` |
| 235 | 11281 | ОСТАВИТЬ — report/clipboard/streaming export lifecycle | `pages/test-runner/test-runner-export-controller.js` |
| 258 | 12844 | ОСТАВИТЬ — граница ответственности оправдана | `pages/test-runner/test-runner-probe.js` |
| 1166 | 72146 | ОСТАВИТЬ — единый state/lifecycle, no-growth budget | `pages/test-runner/test-runner-report.js` |
| 303 | 14855 | ОСТАВИТЬ — граница ответственности оправдана | `pages/test-runner/test-runner-spool.js` |
| 935 | 54917 | ОСТАВИТЬ — единый state/lifecycle, no-growth budget | `pages/test-runner/test-runner-suite.js` |
| 1103 | 59885 | ОСТАВИТЬ — единый state/lifecycle, no-growth budget | `pages/test-runner/test-runner-transitions.js` |
| 720 | 33607 | ОСТАВИТЬ — единый page/run state, no-growth budget; viewer/export вынесены | `pages/test-runner/test-runner-ui.js` |
| 138 | 7161 | ОСТАВИТЬ — граница ответственности оправдана | `pages/test-runner/test-selector.js` |
| 87 | 4635 | ОСТАВИТЬ — Jira HTTP/payload transport | `pages/worklog/worklog-jira-client.js` |
| 587 | 33477 | ОСТАВИТЬ — page/render state; Jira transport вынесен | `pages/worklog/worklog.js` |

## Production HTML и CSS

| Строк | Байт | Решение | Файл |
|---:|---:|---|---|
| 375 | 7143 | ОСТАВИТЬ — base/progress; workflow styles вынесены | `pages/batch/batch.css` |
| 553 | 11171 | ОСТАВИТЬ — panel/series workflow styles | `pages/batch/batch-workflow.css` |
| 319 | 20424 | ОСТАВИТЬ — composition root; фрагментация добавит runtime-загрузку | `pages/batch/batch.html` |
| 570 | 12694 | ОСТАВИТЬ — base/cards; feature styles вынесены | `pages/dashbridge/dashbridge.css` |
| 403 | 8682 | ОСТАВИТЬ — dialogs and dashboard picker styles | `pages/dashbridge/dashbridge-dialogs.css` |
| 420 | 9062 | ОСТАВИТЬ — time picker, drag/drop and fullscreen styles | `pages/dashbridge/dashbridge-interactions.css` |
| 230 | 16022 | ОСТАВИТЬ — report/SLA editor styles | `pages/dashbridge/dashbridge-report.css` |
| 453 | 29700 | ОСТАВИТЬ — composition root; фрагментация добавит runtime-загрузку | `pages/dashbridge/dashbridge.html` |
| 28 | 2971 | ОСТАВИТЬ — область одной страницы/компонента | `pages/debug-easter-egg/debug-easter-egg.css` |
| 31 | 1564 | ОСТАВИТЬ — composition root; фрагментация добавит runtime-загрузку | `pages/debug-easter-egg/debug-easter-egg.html` |
| 696 | 15525 | ОСТАВИТЬ — область одной страницы/компонента | `pages/options/options.css` |
| 477 | 30371 | ОСТАВИТЬ — composition root; фрагментация добавит runtime-загрузку | `pages/options/options.html` |
| 727 | 19267 | ОСТАВИТЬ — область одной страницы/компонента | `pages/popup/popup.css` |
| 436 | 27346 | ОСТАВИТЬ — composition root; фрагментация добавит runtime-загрузку | `pages/popup/popup.html` |
| 154 | 13647 | ОСТАВИТЬ — область одной страницы/компонента | `pages/recorder/recorder.css` |
| 178 | 11042 | ОСТАВИТЬ — composition root; фрагментация добавит runtime-загрузку | `pages/recorder/recorder.html` |
| 111 | 2446 | ОСТАВИТЬ — область одной страницы/компонента | `pages/shared/operation-progress.css` |
| 545 | 14740 | ОСТАВИТЬ — legacy/dark compatibility layer | `pages/shared/theme-compat.css` |
| 739 | 18075 | ОСТАВИТЬ — shared tokens/components; compatibility и Options styles вынесены | `pages/shared/theme.css` |
| 290 | 8628 | ОСТАВИТЬ — область одной страницы/компонента | `pages/test-runner/test-runner.css` |
| 683 | 22098 | ОСТАВИТЬ — composition root; фрагментация добавит runtime-загрузку | `pages/test-runner/test-runner.html` |
| 35 | 3742 | ОСТАВИТЬ — область одной страницы/компонента | `pages/test-runner/test-selector.css` |
| 42 | 1947 | ОСТАВИТЬ — composition root; фрагментация добавит runtime-загрузку | `pages/test-runner/test-selector.html` |
| 654 | 16398 | ОСТАВИТЬ — область одной страницы/компонента | `pages/worklog/worklog.css` |
| 97 | 5027 | ОСТАВИТЬ — composition root; фрагментация добавит runtime-загрузку | `pages/worklog/worklog.html` |
## Тесты и fixtures

| Строк | Байт | Решение | Файл |
|---:|---:|---|---|
| 3 | 171 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/fixtures/grafana-frame.html` |
| 9 | 366 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/fixtures/grafana-panel-viz-key.html` |
| 9 | 310 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/fixtures/grafana-panel.html` |
| 92 | 3543 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/analyze_e2e_diagnostics_layout.js` |
| 404 | 17771 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/analyze_e2e_diagnostics_slice.js` |
| 72 | 2657 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/analyze_e2e_diagnostics_summary.js` |
| 76 | 2979 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/analyze_e2e_diagnostics_test_size.js` |
| 46 | 2882 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/archive_budget_behavior.js` |
| 135 | 5714 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/audit_theme_overrides.py` |
| 264 | 11566 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/audit_theme_quality.py` |
| 614 | 32787 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/audit_ui_theme.py` |
| 101 | 6361 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/background_gui_capture_behavior.js` |
| 65 | 3746 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/batch_capture_utils_behavior.js` |
| 47 | 2773 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/batch_dashboard_picker_behavior.js` |
| 92 | 3883 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/batch_main_run_controller_behavior.js` |
| 162 | 6412 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/batch_page_controller_behavior.js` |
| 87 | 3664 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/batch_panel_capture_context_behavior.js` |
| 54 | 2336 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/batch_panel_rules_behavior.js` |
| 24 | 1028 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/batch_run_lifecycle_behavior.js` |
| 110 | 4250 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/batch_series_discovery_controller_behavior.js` |
| 190 | 7746 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/batch_series_run_controller_behavior.js` |
| 68 | 2622 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/batch_series_selection_behavior.js` |
| 45 | 2315 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/batch_state_restore_behavior.js` |
| 26 | 1068 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/bounded_journal_behavior.js` |
| 78 | 3280 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/confluence_bridge_behavior.js` |
| 111 | 3699 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/confluence_focus_lifecycle_behavior.js` |
| 207 | 11488 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/controller_split_behavior.js` |
| 152 | 10435 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_auto_refresh_behavior.js` |
| 31 | 1757 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_capture_module_behavior.js` |
| 56 | 3724 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_dashboard_picker_behavior.js` |
| 99 | 4307 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_data_migration_behavior.js` |
| 102 | 4955 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_iframe_message_controller_behavior.js` |
| 117 | 4487 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_modal_behavior.js` |
| 143 | 5981 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_page_ui_controller_behavior.js` |
| 131 | 5201 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_panel_actions_controller_behavior.js` |
| 118 | 5052 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_panel_addition_controller_behavior.js` |
| 96 | 4903 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_panel_analysis_controller_behavior.js` |
| 155 | 6477 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_panel_card_controller_behavior.js` |
| 118 | 5873 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_panel_tools_controller_behavior.js` |
| 117 | 5653 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_panel_transfer_behavior.js` |
| 145 | 6094 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_panel_transfer_controller_behavior.js` |
| 94 | 5226 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_panel_url_behavior.js` |
| 63 | 2839 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_profile_concurrency_behavior.js` |
| 62 | 3046 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_profile_store_behavior.js` |
| 75 | 4155 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_renderer_safety_behavior.js` |
| 73 | 4585 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_report_audit_behavior.js` |
| 73 | 4550 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_report_behavior.js` |
| 86 | 4229 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_report_controller_behavior.js` |
| 214 | 16473 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_report_integration_behavior.js` |
| 34 | 2021 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_report_schema_behavior.js` |
| 58 | 3365 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_report_test_runner_behavior.js` |
| 146 | 5469 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_report_transport_behavior.js` |
| 153 | 7601 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_report_ui_behavior.js` |
| 89 | 3428 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_report_variable_contract_behavior.js` |
| 22 | 1397 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_tab_profile_behavior.js` |
| 141 | 7083 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_time_controller_behavior.js` |
| 50 | 2216 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashbridge_time_state_behavior.js` |
| 50 | 3045 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashflow_compare_behavior.js` |
| 128 | 5337 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashflow_export_behavior.js` |
| 149 | 6748 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashflow_io_behavior.js` |
| 244 | 23123 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashflow_recorder_behavior.js` |
| 49 | 3471 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dashflow_xlsx_behavior.js` |
| 45 | 2281 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dependency_contracts_behavior.js` |
| 200 | 9574 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/devtools-e2e-idempotence-diagnostics.js` |
| 73 | 4184 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/devtools-e2e-panel-diagnostics.js` |
| 99 | 4921 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/devtools-e2e-visual-diagnostics.js` |
| 26 | 1509 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/dnr_session_rules_behavior.js` |
| 82 | 4414 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/extension_package_integrity_behavior.js` |
| 51 | 2388 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_calculated_title_behavior.js` |
| 127 | 10225 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_capture_layout_behavior.js` |
| 61 | 2052 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_compact_layout_behavior.js` |
| 39 | 1597 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_complete_hide_url_behavior.js` |
| 264 | 14010 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_cpu_capacity_filter_behavior.js` |
| 39 | 2010 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_dashboard_api_behavior.js` |
| 56 | 2841 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_dashbridge_transform_bootstrap_behavior.js` |
| 39 | 1442 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_e2e_profile_behavior.js` |
| 71 | 2746 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_flot_response_filter_remount_behavior.js` |
| 31 | 1431 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_legend_visuals_module_behavior.js` |
| 97 | 4701 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_mem_conversion_atomic_behavior.js` |
| 55 | 2198 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_memory_unit_restore_behavior.js` |
| 71 | 3264 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_metric_keyword_literal_behavior.js` |
| 60 | 4229 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_network_behavior.js` |
| 316 | 18247 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_panel_analysis_behavior.js` |
| 52 | 1935 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_panel_data_runtime_behavior.js` |
| 131 | 6481 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_panel_definition_behavior.js` |
| 64 | 3690 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_panel_feature_scope_behavior.js` |
| 20 | 1421 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_panel_identity_behavior.js` |
| 54 | 2082 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_panel_menu_runtime_behavior.js` |
| 97 | 3949 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_panel_scoped_refresh_behavior.js` |
| 45 | 1742 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_panel_state_page_behavior.js` |
| 159 | 11639 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_panel_tools_persistence_behavior.js` |
| 77 | 3829 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_refresh_policy_behavior.js` |
| 56 | 3588 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_report_legend_names_behavior.js` |
| 48 | 2523 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_report_response_capture_behavior.js` |
| 42 | 1719 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_report_snapshot_module_behavior.js` |
| 39 | 1803 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_response_filter_exclusivity_behavior.js` |
| 48 | 2471 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_response_filter_workspace_behavior.js` |
| 38 | 3666 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_runtime_manifest_behavior.js` |
| 35 | 1618 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_runtime_registration_behavior.js` |
| 53 | 2497 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_series_capture_behavior.js` |
| 202 | 7998 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_series_query_filter_behavior.js` |
| 49 | 1966 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_series_styles_module_behavior.js` |
| 60 | 4157 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_settings_behavior.js` |
| 66 | 3787 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_table_report_behavior.js` |
| 35 | 1587 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_threshold_highlight_flot_offset_behavior.js` |
| 35 | 1358 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_threshold_highlight_interpolation_behavior.js` |
| 82 | 5222 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_threshold_highlight_remount_behavior.js` |
| 173 | 8848 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_threshold_highlight_toggle_behavior.js` |
| 44 | 1907 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_threshold_highlight_uplot_offset_behavior.js` |
| 58 | 3335 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_threshold_highlight_width_behavior.js` |
| 21 | 1129 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_threshold_layout_cleanup_behavior.js` |
| 52 | 2053 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_threshold_visuals_module_behavior.js` |
| 53 | 2978 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_time_picker_clipboard_behavior.js` |
| 26 | 1122 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_time_ranges_behavior.js` |
| 44 | 2292 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_timestamp_clipboard_behavior.js` |
| 74 | 4124 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_unit_behavior.js` |
| 167 | 9622 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/grafana_vcpu_legend_behavior.js` |
| 72 | 4369 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/installer_behavior.js` |
| 87 | 3860 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/jira_transfer_safety_behavior.js` |
| 51 | 3294 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/legend_complete_hide_behavior.js` |
| 28 | 1012 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/legend_selection_patterns_behavior.js` |
| 78 | 3842 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/live_grafana_e2e_runner_behavior.js` |
| 75 | 4845 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/local_state_schema_behavior.js` |
| 85 | 4919 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/operation_progress_window_behavior.js` |
| 115 | 7035 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/options_user_settings_behavior.js` |
| 93 | 6759 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/panel_settings_external_text_behavior.js` |
| 131 | 8888 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/popup_initial_layout_behavior.js` |
| 35 | 1930 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/popup_update_notice_behavior.js` |
| 19 | 745 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/README.md` |
| 49 | 1932 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/recorder_action_capture_behavior.js` |
| 163 | 6398 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/recorder_dashflow_controller_behavior.js` |
| 188 | 7657 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/recorder_network_capture_behavior.js` |
| 154 | 5923 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/recorder_session_controller_behavior.js` |
| 151 | 5226 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/recorder_session_transport_behavior.js` |
| 53 | 1892 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/recorder_settings_behavior.js` |
| 32 | 2057 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/recorder_view_module_behavior.js` |
| 55 | 2818 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/release_workflow_behavior.js` |
| 109 | 7468 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/responsive_layout_behavior.js` |
| 25 | 1041 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/run-all-tests.js` |
| 269 | 10971 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/run-extension-browser-smoke.js` |
| 35 | 1310 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/run-js-tests.js` |
| 64 | 2375 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/run-python-smoke-tests.js` |
| 24 | 696 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/security_tdm_domain_guard.py` |
| 16 | 1462 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_architecture_contracts.py` |
| 78 | 5992 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_batch_audit_regressions.py` |
| 46 | 2979 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_batch_capture.py` |
| 40 | 2949 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_batch_panel_rules.py` |
| 35 | 2304 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_batch_theme.py` |
| 107 | 9032 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_batch_worklog_workflows.py` |
| 15 | 780 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_confluence_content.py` |
| 31 | 2031 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_crosshair_sync.py` |
| 557 | 23543 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_dashbridge_core.py` |
| 29 | 1857 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_dashbridge_drag_drop.py` |
| 26 | 1243 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_dashbridge_iframe_theme.py` |
| 55 | 3299 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_dashbridge_lazy_iframes.py` |
| 37 | 2689 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_dashbridge_paused_snapshots.py` |
| 63 | 5327 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_dashbridge_profiles_time.py` |
| 58 | 3962 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_debug_easter_egg.py` |
| 48 | 2435 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_extension_wiring.py` |
| 88 | 3809 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_grafana_dom_compatibility.py` |
| 40 | 3228 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_grafana_iframe_rules.py` |
| 24 | 1112 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_grafana_legend_filter_scenarios.py` |
| 40 | 2779 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_grafana_legend_filter.py` |
| 32 | 2206 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_grafana_legend_visuals.py` |
| 21 | 1386 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_grafana_line_width.py` |
| 434 | 38020 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_grafana_panel_tools.py` |
| 65 | 3597 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_grafana_save_to_profile.py` |
| 47 | 1817 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_grafana_time_formats.py` |
| 26 | 1400 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_gui_capture_ready.py` |
| 72 | 6900 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_lifecycle_contracts.py` |
| 53 | 3319 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_options.py` |
| 102 | 4694 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_popup_contracts.py` |
| 72 | 4156 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_popup_grafana_screenshot.py` |
| 34 | 2251 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_postmessage_origins.py` |
| 25 | 1305 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_resource_lifecycle.py` |
| 431 | 27516 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_test_runner_matrix.py` |
| 30 | 1432 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_theme_runtime.py` |
| 36 | 1449 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_theme_tokens.py` |
| 70 | 3454 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_visual_style_contract.py` |
| 22 | 924 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/smoke_worklog.py` |
| 59 | 3022 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/storage_writer_behavior.js` |
| 1 | 59 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/support/__init__.py` |
| 157 | 4396 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/support/smoke.py` |
| 40 | 1523 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/sync_input_writer_behavior.js` |
| 22 | 1654 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/tdm_export_lifecycle_behavior.js` |
| 78 | 4001 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/test_runner_chunked_export_behavior.js` |
| 121 | 6503 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/test_runner_disk_spool_behavior.js` |
| 189 | 8488 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/test_runner_generator_behavior.js` |
| 42 | 1900 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/test_runner_diagnostic_diff_behavior.js` |
| 18 | 823 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/test_runner_layout_behavior.js` |
| 35 | 1432 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/test_runner_probe_behavior.js` |
| 343 | 21432 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/test_runner_report_artifact_behavior.js` |
| 54 | 2066 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/test_runner_reporting_behavior.js` |
| 90 | 6333 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/test_runner_selection_behavior.js` |
| 57 | 2272 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/test_runner_ui_controllers_behavior.js` |
| 70 | 4325 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/test_runner_visual_reuse_behavior.js` |
| 27 | 1619 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/test_suite_structure_behavior.js` |
| 50 | 2165 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/theme_runtime_behavior.js` |
| 50 | 2281 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/update_check_behavior.js` |
| 21 | 1092 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/url_validation_behavior.js` |
| 28 | 1345 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/worklog_regressions_behavior.js` |
| 49 | 1896 | ОСТАВИТЬ — самостоятельный тестовый контракт | `test/worklog_jira_client_behavior.js` |

## Dev/release scripts

| Строк | Байт | Решение | Файл |
|---:|---:|---|---|
| 42 | 1171 | ОСТАВИТЬ — отдельный dev/release lifecycle | `.github/workflows/release.yml` |
| 121 | 5170 | ОСТАВИТЬ — отдельный dev/release lifecycle | `scripts/build-release.ps1` |
| 308 | 15496 | ОСТАВИТЬ — отдельный dev/release lifecycle | `scripts/check-dependency-contracts.js` |
| 44 | 1726 | ОСТАВИТЬ — отдельный dev/release lifecycle | `scripts/check-documentation-links.js` |
| 86 | 3438 | ОСТАВИТЬ — отдельный dev/release lifecycle | `scripts/check-grafana-e2e-session.js` |
| 63 | 2336 | ОСТАВИТЬ — отдельный dev/release lifecycle | `scripts/check-module-boundaries.js` |
| 507 | 27034 | ОСТАВИТЬ — отдельный dev/release lifecycle | `scripts/Install-DashBridge.ps1` |
| 58 | 2244 | ОСТАВИТЬ — отдельный dev/release lifecycle | `scripts/module-size-budgets.json` |
| 381 | 17659 | ОСТАВИТЬ — отдельный dev/release lifecycle | `scripts/run-live-grafana-e2e.js` |
| 113 | 4500 | ОСТАВИТЬ — отдельный dev/release lifecycle | `scripts/setup-grafana-e2e-profile.js` |

## Документация

| Строк | Байт | Решение | Файл |
|---:|---:|---|---|
| 116 | 7891 | ОСТАВИТЬ — самостоятельный документ | `AGENTS.md` |
| 814 | 72039 | ОСТАВИТЬ — самостоятельный документ | `docs/architecture.md` |
| 125 | 9654 | ОСТАВИТЬ — самостоятельный документ | `docs/dashflow-v2.md` |
| 282 | 21737 | ОСТАВИТЬ — самостоятельный документ | `docs/development-guide.md` |
| 50 | 3573 | ОСТАВИТЬ — самостоятельный документ | `docs/history/architecture-decisions.md` |
| 11 | 884 | ОСТАВИТЬ — самостоятельный документ | `docs/history/legacy-global-dnr-rule.md` |
| 89 | 7282 | ОСТАВИТЬ — самостоятельный документ | `docs/installer.md` |
| 200 | 12756 | ОСТАВИТЬ — самостоятельный документ | `docs/module-design.md` |
| 36 | 4341 | ОСТАВИТЬ — самостоятельный документ | `docs/permission-map.md` |
| 276 | 11194 | ОСТАВИТЬ — самостоятельный документ | `docs/prototypes/grafana-axis-density.md` |
| 52 | 4090 | ОСТАВИТЬ — самостоятельный документ | `docs/README.md` |
| 78 | 5764 | ОСТАВИТЬ — самостоятельный документ | `docs/roadmap.md` |
| 344 | 25737 | ОСТАВИТЬ — самостоятельный документ | `README.md` |

## Конфигурация, assets и vendor

| Строк | Байт | Решение | Файл |
|---:|---:|---|---|
| 18 | 519 | ОСТАВИТЬ — единый config/schema | `.gitignore` |
| 184 | 9328 | ОСТАВИТЬ | `eslint.config.js` |
| 6 | 523 | ОСТАВИТЬ — asset | `icons/dashbridge-mark.svg` |
| — | 1577 | ОСТАВИТЬ — asset | `icons/icon128.png` |
| — | 340 | ОСТАВИТЬ — asset | `icons/icon16.png` |
| — | 1075 | ОСТАВИТЬ — asset | `icons/icon48.png` |
| 80 | 2210 | ОСТАВИТЬ — единый config/schema | `manifest.json` |
| 948 | 33122 | Generated lock: не делить и не редактировать вручную | `package-lock.json` |
| 23 | 799 | ОСТАВИТЬ — единый config/schema | `package.json` |
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
