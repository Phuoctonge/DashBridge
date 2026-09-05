'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const appRoot = path.resolve(__dirname, '..');
const repositoryRoot = path.resolve(appRoot, '..', '..');
const read = file => fs.readFileSync(file, 'utf8');

test('production uses a persistent unprivileged runtime without application image builds', () => {
    const compose = read(path.join(appRoot, 'compose.yaml'));
    assert.match(compose, /image:\s*node:24-alpine/);
    assert.match(compose, /user:\s*"10001:10001"/);
    assert.match(compose, /\.\/app:\/app:ro/);
    assert.match(compose, /\.\/data:\/data/);
    assert.doesNotMatch(compose, /\bbuild:/);
});

test('the restricted release excludes data and administrative deployment controls', () => {
    const publish = read(path.join(repositoryRoot, 'scripts', 'Publish-Analytics.ps1'));
    const apply = read(path.join(appRoot, 'ops', 'dashbridge-analytics-apply'));
    assert.match(publish, /server\.js.*analytics-contract\.js/s);
    assert.match(publish, /Copy-Item.*public/s);
    assert.doesNotMatch(publish, /Copy-Item[^\n]+compose\.yaml/);
    assert.doesNotMatch(publish, /Copy-Item[^\n]+DATA_DIR/);
    assert.match(apply, /server\.js\|analytics-contract\.js\|public\|public\/\*/);
    assert.match(apply, /release contains a link or special file/);
    assert.match(apply, /unsafe archive entry/);
    assert.match(apply, /release archive exceeds 4 MiB/);
    assert.match(apply, /Health check failed; restoring/);
});
