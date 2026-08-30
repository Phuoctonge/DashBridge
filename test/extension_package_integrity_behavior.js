'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const exists = relativePath => fs.existsSync(path.join(root, relativePath));
const manifest = JSON.parse(read('manifest.json'));
const manifestReferences = [
    manifest.background?.service_worker, manifest.action?.default_popup, manifest.options_ui?.page,
    ...Object.values(manifest.icons || {}), ...Object.values(manifest.action?.default_icon || {}),
    ...(manifest.content_scripts || []).flatMap(entry => entry.js || []),
    ...(manifest.web_accessible_resources || []).flatMap(entry => entry.resources || []),
].filter(Boolean);
assert.deepStrictEqual(manifestReferences.filter(reference => !exists(reference)), [], 'every manifest resource must exist');

const htmlFiles = [];
const loadedScriptPaths = new Set((manifest.content_scripts || []).flatMap(entry => entry.js || []));
const collectHtml = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (['.git', '.pytest_cache', '__pycache__', 'docs', 'plans'].includes(entry.name)) continue;
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) collectHtml(absolute);
        else if (entry.name.endsWith('.html')) htmlFiles.push(absolute);
    }
};
collectHtml(root);
for (const htmlFile of htmlFiles) {
    const html = fs.readFileSync(htmlFile, 'utf8');
    const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
    const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
    assert.deepStrictEqual(duplicateIds, [], `${path.relative(root, htmlFile)} must not contain duplicate IDs`);
    const references = [...html.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)].map(match => match[1]);
    for (const reference of references) {
        if (!reference.split(/[?#]/, 1)[0].endsWith('.js')) continue;
        loadedScriptPaths.add(path.relative(root, path.resolve(path.dirname(htmlFile), reference.split(/[?#]/, 1)[0])).replaceAll('\\', '/'));
    }
    const missing = references.filter(reference => {
        if (/^(?:https?:|data:|#)/i.test(reference)) return false;
        const cleanReference = reference.split(/[?#]/, 1)[0];
        return cleanReference && !fs.existsSync(path.resolve(path.dirname(htmlFile), cleanReference));
    });
    assert.deepStrictEqual(missing, [], `${path.relative(root, htmlFile)} must reference existing local resources`);
}

const sourceFiles = [];
const collectSources = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (['test', 'docs', 'plans', '.git', '.pytest_cache', '__pycache__'].includes(entry.name)) continue;
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) collectSources(absolute);
        else if (/\.(?:js|html|json)$/.test(entry.name)) sourceFiles.push(absolute);
    }
};
collectSources(root);
const runtimeCorpus = sourceFiles.map(file => fs.readFileSync(file, 'utf8')).join('\n');
const productionScripts = [];
const collectScripts = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) collectScripts(absolute);
        else if (entry.name.endsWith('.js')) productionScripts.push(absolute);
    }
};
collectScripts(path.join(root, 'js'));
collectScripts(path.join(root, 'pages'));
const orphanScripts = productionScripts
    .map(file => ({
        rootRelative: path.relative(root, file).replaceAll('\\', '/'),
        jsRelative: path.relative(path.join(root, 'js'), file).replaceAll('\\', '/'),
    }))
    .filter(reference => !loadedScriptPaths.has(reference.rootRelative)
        && !runtimeCorpus.includes(reference.rootRelative)
        && !runtimeCorpus.includes(reference.jsRelative))
    .map(reference => reference.rootRelative);
assert.deepStrictEqual(orphanScripts, [], 'every production script must have a runtime entry point');
console.log(`PASS extension package integrity (${htmlFiles.length} HTML files, ${productionScripts.length} production scripts)`);
