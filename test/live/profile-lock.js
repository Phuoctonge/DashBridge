'use strict';
const fs = require('node:fs');
const path = require('node:path');

function acquireProfileLock(profileRoot) {
    fs.mkdirSync(profileRoot, { recursive: true });
    const lockPath = path.join(profileRoot, 'live.lock');
    let fd;
    try { fd = fs.openSync(lockPath, 'wx'); }
    catch (error) {
        if (error.code === 'EEXIST') throw new Error(`Live profile is already locked: ${profileRoot}`);
        throw error;
    }
    fs.writeFileSync(fd, `${process.pid}\n`, 'utf8');
    let released = false;
    return { release() { if (released) return; released = true; fs.closeSync(fd); fs.rmSync(lockPath, { force: true }); } };
}

module.exports = { acquireProfileLock };
