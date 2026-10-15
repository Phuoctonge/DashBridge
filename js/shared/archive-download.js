// Writes a JSZip instance through the extension download API.
async function downloadZipArchive(zip, filename, { isActive = () => true } = {}) {
    if (!isActive()) return null;
    const content = await zip.generateAsync({ type: 'blob' });
    // Packaging can outlive its Batch owner. Never register a late download
    // after cancellation; already registered browser downloads stay browser-owned.
    if (!isActive()) return null;
    const blobUrl = URL.createObjectURL(content);
    try {
        // The browser owns the payload after download registration resolves.
        return await chrome.downloads.download({ url: blobUrl, filename, saveAs: false });
    } finally {
        // Failed registrations must release the URL too; otherwise every retry
        // retains the generated ZIP Blob for the lifetime of the page.
        URL.revokeObjectURL(blobUrl);
    }
}

// Keeps only one uncompressed ZIP part in the active collection. The original
// filename is preserved for small exports; part suffixes appear only after an
// actual rollover.
function createRollingZipArchive({ filename, maxBytes, zipFactory = () => new JSZip(), download = downloadZipArchive,
    isActive = () => true }) {
    let zip = zipFactory();
    let usedBytes = 0;
    let fileCount = 0;
    let rolled = false;
    let downloadedParts = 0;
    const partFilename = part => filename.replace(/\.zip$/i, `_part-${String(part).padStart(3, '0')}.zip`);
    const flushPart = async isRollover => {
        if (!fileCount || !isActive()) return null;
        if (isRollover) rolled = true;
        const outputName = rolled ? partFilename(downloadedParts + 1) : filename;
        const downloadId = await download(zip, outputName, { isActive });
        if (!isActive()) return null;
        downloadedParts += 1;
        zip = zipFactory();
        usedBytes = 0;
        fileCount = 0;
        return { downloadId, filename: outputName };
    };
    return {
        async add(name, data, bytes = data?.byteLength ?? data?.length ?? 0, options) {
            if (!isActive()) return null;
            const size = Math.max(0, Number(bytes) || 0);
            if (size > maxBytes) throw new RangeError(`Файл ${name} превышает размер одной части архива.`);
            if (fileCount && usedBytes + size > maxBytes) await flushPart(true);
            if (!isActive()) return null;
            zip.file(name, data, options);
            usedBytes += size;
            fileCount += 1;
            return { part: downloadedParts + 1, usedBytes, fileCount };
        },
        finalize() { return flushPart(false); },
        get rolled() { return rolled; },
        get downloadedParts() { return downloadedParts; },
        get usedBytes() { return usedBytes; },
    };
}
