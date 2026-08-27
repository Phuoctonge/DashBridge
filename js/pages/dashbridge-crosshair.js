// Coalesces pointer broadcasts between Grafana iframes.
function createDashBridgeCrosshair({ frames, send, isEnabled }) {
    let animationFrame = null;
    let pending = null;
    const flush = () => {
        animationFrame = null;
        const event = pending;
        pending = null;
        if (!event) return;
        frames().forEach(frame => {
            if (frame !== event.source && frame.contentWindow && frame.src && frame.src !== 'about:blank') {
                send(frame, { action: 'syncCrosshair', percentX: event.percentX, timestamp: event.timestamp });
            }
        });
    };
    return {
        broadcast(percentX, timestamp, source) {
            if (!isEnabled()) return;
            pending = { percentX, timestamp, source };
            if (!animationFrame) animationFrame = requestAnimationFrame(flush);
        },
        hide() {
            if (animationFrame) cancelAnimationFrame(animationFrame);
            animationFrame = null;
            pending = null;
            frames().forEach(frame => {
                if (frame.contentWindow && frame.src && frame.src !== 'about:blank') send(frame, { action: 'hideCrosshair' });
            });
        }
    };
}
