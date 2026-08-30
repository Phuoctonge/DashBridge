'use strict';

const assert = require('node:assert');
const path = require('node:path');
const { resolveProfileRoot, validateGrafanaUrls } = require('../scripts/setup-grafana-e2e-profile');

assert.deepStrictEqual(validateGrafanaUrls([
    'https://grafana-one.example/d/main',
    'https://grafana-two.example/d/legacy?orgId=1'
]), [
    'https://grafana-one.example/d/main',
    'https://grafana-two.example/d/legacy?orgId=1'
]);
assert.deepStrictEqual(validateGrafanaUrls([
    'https://grafana-one.example/d/main'
]), [
    'https://grafana-one.example/d/main'
]);
assert.throws(() => validateGrafanaUrls([]), /one or two/);
assert.throws(() => validateGrafanaUrls([
    'https://grafana-one.example',
    'https://grafana-two.example',
    'https://grafana-three.example'
]), /one or two/);
assert.throws(() => validateGrafanaUrls([
    'file:///tmp/grafana',
    'https://grafana-two.example'
]), /Only HTTP\(S\)/);
assert.throws(() => validateGrafanaUrls([
    'https://user:secret@grafana-one.example',
    'https://grafana-two.example'
]), /Do not put a username/);
assert.throws(() => validateGrafanaUrls([
    'https://grafana-one.example',
    'https://grafana-one.example'
]), /must be different/);
assert.throws(() => resolveProfileRoot(path.resolve(__dirname, '..', 'test-results', 'profile')), /outside the repository/);

console.log('PASS persistent Grafana E2E profile stays isolated from credentials and repository data');
