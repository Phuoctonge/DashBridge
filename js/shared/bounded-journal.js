// Small dependency-free ring-buffer helper for long-lived extension runtimes.
// It intentionally keeps the caller's event IDs and public journal object.
(() => {
    if (globalThis.DashBridgeBoundedJournal) return;

    const normalizeLimit = (value, fallback = 300) => {
        const parsed = Number(value);
        return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
    };

    const capExisting = (journal, limit = 300) => {
        const max = normalizeLimit(limit);
        journal.events = Array.isArray(journal.events) ? journal.events : [];
        journal.totalEvents = Math.max(Number(journal.totalEvents) || 0, journal.events.length);
        journal.droppedEvents = Math.max(Number(journal.droppedEvents) || 0, 0);
        if (journal.events.length > max) {
            const removed = journal.events.length - max;
            journal.events.splice(0, removed);
            journal.droppedEvents += removed;
        }
        journal.eventLimit = max;
        return journal;
    };

    const pushEvent = (journal, event, limit = 300) => {
        const max = normalizeLimit(limit);
        capExisting(journal, max);
        journal.events.push(event);
        journal.totalEvents += 1;
        if (journal.events.length > max) {
            const removed = journal.events.length - max;
            journal.events.splice(0, removed);
            journal.droppedEvents += removed;
        }
        return event;
    };

    const setRecentRecord = (records, key, value, limit = 100) => {
        const max = normalizeLimit(limit, 100);
        if (!Object.prototype.hasOwnProperty.call(records, key)) {
            while (Object.keys(records).length >= max) {
                delete records[Object.keys(records)[0]];
            }
        }
        records[key] = value;
        return value;
    };

    globalThis.DashBridgeBoundedJournal = { capExisting, pushEvent, setRecentRecord };
})();
