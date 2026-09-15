'use strict';

function validateIframeMessage(message, extensionOrigin) {
    return !!message && message.origin === extensionOrigin && message.sourceMatches === true
        && message.action === 'dashbridgeFrameLocation' && typeof message.requestId === 'string'
        && message.requestId.length > 0 && message.requestId.length <= 128;
}
async function snapshotIframes(page) {
    return page.evaluate(() => Array.from(document.querySelectorAll('iframe')).slice(0, 50).map(frame => ({ name: frame.name || '', src: frame.src ? new URL(frame.src, location.href).origin : '', connected: frame.isConnected })));
}
module.exports = { validateIframeMessage, snapshotIframes };
