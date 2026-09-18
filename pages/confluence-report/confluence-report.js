(function initConfluenceReportPage(root) {
    'use strict';
    const archiveInput = document.getElementById('archiveInput'); const archiveStatus = document.getElementById('archiveStatus');
    const summaryCard = document.getElementById('summaryCard'); const sourceCount = document.getElementById('sourceCount');
    const testCount = document.getElementById('testCount'); const imageCount = document.getElementById('imageCount');
    const pageStatus = document.getElementById('pageStatus'); let controller = null;
    const setStatus = (element, value, error = false) => { element.textContent = value; element.toggleAttribute('data-error', error); };
    const countImages = snapshot => snapshot.tests.reduce((sum, test) => sum + test.groups.reduce((groupSum, group) => groupSum + group.images.length, 0), 0);
    archiveInput.addEventListener('change', async () => {
        const file = archiveInput.files?.[0]; if (!file) return; controller?.abort(); controller = new AbortController();
        try {
            setStatus(archiveStatus, 'Чтение архива…');
            const zip = root.DashBridgeConfluenceReportZip.create({ JSZip: root.JSZip, schema: root.DashBridgeConfluenceReportSchema });
            const archive = await zip.load(file, controller.signal); sourceCount.textContent = archive.sources.size;
            const snapshot = root.DashBridgeConfluenceReportScanner.fromStorageHtml('', { editorKind: 'pending' });
            testCount.textContent = snapshot.tests.length; imageCount.textContent = countImages(snapshot); summaryCard.hidden = false;
            setStatus(archiveStatus, `Архив прочитан: ${archive.sources.size} источников.`); pageStatus.textContent = 'Готово к browser discovery живой страницы Confluence.';
        } catch (error) { if (error?.name !== 'AbortError') setStatus(archiveStatus, error?.message || 'Не удалось прочитать архив.', true); }
    });
})(globalThis);
