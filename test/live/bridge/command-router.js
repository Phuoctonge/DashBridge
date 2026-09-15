'use strict';

function createCommandRouter({ token, handlers, maxPayloadBytes = 4096 } = {}) {
    if (typeof token !== 'string' || !token) throw new TypeError('bridge token is required');
    const catalog = new Map(Object.entries(handlers || {}));
    const active = new Set();
    const seen = new Set();
    return { dispatch: async command => {
        if (!command || command.token !== token) throw new Error('invalid bridge token');
        if (typeof command.commandId !== 'string' || !command.commandId || active.has(command.commandId) || seen.has(command.commandId)) throw new Error('duplicate or missing commandId');
        if (!catalog.has(command.capability)) throw new Error('unknown capability');
        const serialized = JSON.stringify(command.args === undefined ? {} : command.args);
        if (Buffer.byteLength(serialized, 'utf8') > maxPayloadBytes) throw new Error('command payload exceeds size limit');
        active.add(command.commandId); seen.add(command.commandId);
        try { return { status: 'executed', commandId: command.commandId, result: await catalog.get(command.capability)(Object.freeze({ ...command })) }; }
        finally { active.delete(command.commandId); }
    } };
}
module.exports = { createCommandRouter };
