#!/usr/bin/env node
'use strict';

// Dependency-free structural guard for the classic-script Chrome extension.
// It complements GitNexus: GitNexus understands symbols/calls, while this file
// validates the string- and load-order contracts that static call graphs miss.

const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set(['.git', '.gitnexus', 'node_modules', '__pycache__']);
const CUSTOM_GLOBAL = /^(?:DashBridge|Batch|Grafana|Recorder|TestRunner|__dashbridge|__dashBridge|getGrafana|normalizeGrafana|parseHttp)/;
const CUSTOM_EVENT = /^dashbridge/i;

function posix(value) {
    return value.split(path.sep).join('/');
}

function walk(root, relative = '') {
    const result = [];
    const absolute = path.join(root, relative);
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
        if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
        const child = path.join(relative, entry.name);
        if (entry.isDirectory()) result.push(...walk(root, child));
        else result.push(posix(child));
    }
    return result;
}

function localReference(root, owner, reference, rootRelative = false) {
    const clean = String(reference || '').split(/[?#]/, 1)[0].replace(/\\/g, '/');
    if (!clean || /^(?:[a-z]+:|\/\/|#)/i.test(clean)) return null;
    const ownerDir = rootRelative ? '' : path.posix.dirname(owner);
    const normalized = path.posix.normalize(path.posix.join(ownerDir, clean));
    if (normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
        return { error: `path escapes repository: ${reference}` };
    }
    return { file: normalized, exists: fs.existsSync(path.join(root, ...normalized.split('/'))) };
}

function matchAll(text, expression, group = 1) {
    return [...text.matchAll(expression)].map(match => match[group]).filter(Boolean);
}

function extractHtml(text) {
    return {
        scripts: matchAll(text, /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi),
        ids: new Set(matchAll(text, /\bid\s*=\s*["']([A-Za-z][\w:.-]*)["']/gi)),
    };
}

function extractDynamicReferences(file, text) {
    const references = [];
    const addStrings = (body, kind, rootRelative) => {
        for (const value of matchAll(body, /["']([^"'\r\n]+)["']/g)) {
            if (/\.(?:js|html|css|json|svg)$/i.test(value.split(/[?#]/, 1)[0])) {
                references.push({ value, kind, rootRelative });
            }
        }
    };
    for (const match of text.matchAll(/\bimportScripts\s*\(([^)]*)\)/gs)) addStrings(match[1], 'importScripts', false);
    for (const match of text.matchAll(/\bfiles\s*:\s*\[([^\]]*)\]/gs)) addStrings(match[1], 'executeScript.files', true);
    for (const match of text.matchAll(/\b(?:chrome\.)?runtime\.getURL\s*\(\s*["']([^"']+)["']/g)) {
        references.push({ value: match[1], kind: 'runtime.getURL', rootRelative: true });
    }
    if (file === 'js/shared/grafana-runtime-manifest.js') {
        const array = text.match(/\bconst\s+files\s*=\s*Object\.freeze\s*\(\s*\[([\s\S]*?)\]\s*\)/);
        if (array) addStrings(array[1], 'grafana runtime manifest', true);
    }
    return references;
}

function extractGlobals(text) {
    const explicit = new Set(matchAll(text, /\b(?:window|globalThis)\.([A-Za-z_$][\w$]*)\s*=(?!=)/g));
    const declarations = new Set();
    for (const name of matchAll(text, /^(?:const|let|var|class|function)\s+([A-Za-z_$][\w$]*)\b/gm)) {
        if (/^[A-Z]/.test(name)) declarations.add(name);
    }
    return new Set([...explicit].filter(name => CUSTOM_GLOBAL.test(name)).concat([...declarations]));
}

function extractDom(text) {
    const consumers = new Set(matchAll(text, /\bgetElementById\s*\(\s*["']([A-Za-z][\w:.-]*)["']\s*\)\s*\./g));
    for (const selector of matchAll(text, /\bquerySelector\s*\(\s*["']([^"']+)["']\s*\)\s*\./g)) {
        for (const id of matchAll(selector, /#([A-Za-z][\w:.-]*[A-Za-z0-9_])/g)) consumers.add(id);
    }
    const producers = new Set(matchAll(text, /\bid\s*=\s*["']([A-Za-z][\w:.-]*)["']/g));
    for (const id of matchAll(text, /\bsetAttribute\s*\(\s*["']id["']\s*,\s*["']([A-Za-z][\w:.-]*)["']/g)) producers.add(id);
    return { consumers, producers };
}

function mapSetAdd(map, key, value) {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(value);
}

function extractContracts(file, text, contracts) {
    for (const name of matchAll(text, /\bnew\s+(?:CustomEvent|Event)\s*\(\s*["']([^"']+)["']/g)) {
        if (CUSTOM_EVENT.test(name)) mapSetAdd(contracts.customEvents.producers, name, file);
    }
    for (const name of matchAll(text, /\baddEventListener(?:\?\.)?\s*\(\s*["']([^"']+)["']/g)) {
        if (CUSTOM_EVENT.test(name)) mapSetAdd(contracts.customEvents.consumers, name, file);
    }
    for (const call of text.matchAll(/\bpostMessage\s*\(\s*\{([\s\S]{0,800}?)\}\s*,/g)) {
        const action = call[1].match(/\baction\s*:\s*["']([^"']+)["']/)?.[1];
        if (action && CUSTOM_EVENT.test(action)) mapSetAdd(contracts.postMessages.producers, action, file);
    }
    for (const name of matchAll(text, /\b(?:event|message|data)\.data\.action\s*(?:===|==)\s*["']([^"']+)["']/g)) {
        if (CUSTOM_EVENT.test(name)) mapSetAdd(contracts.postMessages.consumers, name, file);
    }
    for (const name of matchAll(text, /\b(?:event|message|data)\.action\s*(?:===|==)\s*["']([^"']+)["']/g)) {
        if (CUSTOM_EVENT.test(name)) mapSetAdd(contracts.postMessages.consumers, name, file);
    }
    for (const call of text.matchAll(/\b(?:runtime|tabs)\.sendMessage\s*\(\s*(?:[^,{]+,\s*)?\{([\s\S]{0,800}?)\}\s*\)/g)) {
        const type = call[1].match(/\btype\s*:\s*["']([^"']+)["']/)?.[1];
        if (type && CUSTOM_EVENT.test(type)) mapSetAdd(contracts.runtimeMessages.producers, type, file);
    }
    for (const name of matchAll(text, /\b(?:message|request|msg)\?*\.type\s*(?:===|==|!==|!=)\s*["']([^"']+)["']/g)) {
        if (CUSTOM_EVENT.test(name)) mapSetAdd(contracts.runtimeMessages.consumers, name, file);
    }
    if (/\b(?:runtime|extension)\.onMessage\.addListener\b/.test(text)) {
        for (const name of matchAll(text, /\bcase\s+["']([^"']+)["']/g)) {
            if (CUSTOM_EVENT.test(name)) mapSetAdd(contracts.runtimeMessages.consumers, name, file);
        }
    }
}

function hasTopLevelUse(text, name) {
    const escaped = name.replace(/[$]/g, '\\$&');
    const expression = new RegExp(`\\b${escaped}\\b`);
    return text.split(/\r?\n/).some(line => /^\S/.test(line) && expression.test(line));
}

function extractStorage(file, text, storage) {
    for (const match of text.matchAll(/\bchrome\.storage\.(local|sync|session)\.(get|set|remove)\s*\(([^;]{0,1200})/g)) {
        const [, area, operation, body] = match;
        const role = operation === 'get' ? 'readers' : 'writers';
        for (const key of matchAll(body, /["']([A-Za-z][\w.-]*)["']/g)) mapSetAdd(storage[role], `${area}:${key}`, file);
        if (operation === 'set') {
            const object = body.match(/^\s*\{([\s\S]*?)\}/)?.[1] || '';
            for (const key of matchAll(object, /(?:^|,)\s*([A-Za-z_$][\w$]*)\s*(?=[:,}])/g)) {
                mapSetAdd(storage.writers, `${area}:${key}`, file);
            }
        }
    }
    for (const match of text.matchAll(/\blocalStorage\.(getItem|setItem|removeItem)\s*\(\s*["']([^"']+)["']/g)) {
        mapSetAdd(storage[match[1] === 'getItem' ? 'readers' : 'writers'], `localStorage:${match[2]}`, file);
    }
}

function serializeMap(map) {
    return Object.fromEntries([...map].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([key, values]) => [key, [...values].sort()]));
}

function analyzeProject(rootDirectory) {
    const root = path.resolve(rootDirectory);
    const allFiles = new Set(walk(root));
    const jsFiles = [...allFiles].filter(file => (file.startsWith('js/') || file.startsWith('pages/')) && file.endsWith('.js')).sort();
    const htmlFiles = [...allFiles].filter(file => file.endsWith('.html') && !file.startsWith('test/fixtures/')).sort();
    const sources = new Map(jsFiles.map(file => [file, fs.readFileSync(path.join(root, ...file.split('/')), 'utf8')]));
    const errors = [];
    const warnings = [];
    const edges = [];
    const addReference = (owner, value, kind, rootRelative) => {
        const target = localReference(root, owner, value, rootRelative);
        if (!target) return;
        if (target.error || !target.exists) errors.push(`${owner}: ${kind} references missing/invalid ${value}`);
        else edges.push({ from: owner, to: target.file, kind });
    };

    let manifest = null;
    if (!allFiles.has('manifest.json')) errors.push('manifest.json is missing');
    else {
        try { manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')); }
        catch (error) { errors.push(`manifest.json is invalid JSON: ${error.message}`); }
    }
    if (manifest) {
        const manifestRefs = [
            ['background.service_worker', manifest.background?.service_worker],
            ['action.default_popup', manifest.action?.default_popup],
            ['options_ui.page', manifest.options_ui?.page],
        ];
        for (const [kind, value] of manifestRefs) if (value) addReference('manifest.json', value, kind, true);
        for (const group of manifest.content_scripts || []) {
            for (const value of [...(group.js || []), ...(group.css || [])]) addReference('manifest.json', value, 'content_scripts', true);
        }
        for (const group of manifest.web_accessible_resources || []) {
            for (const value of group.resources || []) if (!value.includes('*')) addReference('manifest.json', value, 'web_accessible_resources', true);
        }
    }

    const html = new Map();
    for (const file of htmlFiles) {
        const text = fs.readFileSync(path.join(root, file), 'utf8');
        const parsed = extractHtml(text);
        parsed.text = text;
        parsed.files = [];
        for (const value of parsed.scripts) {
            const target = localReference(root, file, value, false);
            if (target?.file) parsed.files.push(target.file);
            addReference(file, value, 'script src', false);
        }
        html.set(file, parsed);
    }

    for (const [file, text] of sources) {
        for (const reference of extractDynamicReferences(file, text)) addReference(file, reference.value, reference.kind, reference.rootRelative);
    }

    const globals = new Map([...sources].map(([file, text]) => [file, extractGlobals(text)]));
    for (const [page, parsed] of html) {
        const availableIds = new Set(parsed.ids);
        for (const script of parsed.files) {
            const source = sources.get(script);
            if (source) for (const id of extractDom(source).producers) availableIds.add(id);
        }
        for (let index = 0; index < parsed.files.length; index += 1) {
            const consumerFile = parsed.files[index];
            const source = sources.get(consumerFile);
            if (!source) continue;
            for (const id of extractDom(source).consumers) {
                if (!availableIds.has(id)) errors.push(`${page}: ${consumerFile} uses missing DOM id #${id}`);
            }
            for (let producerIndex = index + 1; producerIndex < parsed.files.length; producerIndex += 1) {
                const producerFile = parsed.files[producerIndex];
                for (const name of globals.get(producerFile) || []) {
                    if (hasTopLevelUse(source, name)) {
                        errors.push(`${page}: ${consumerFile} consumes global ${name} before ${producerFile} produces it`);
                    }
                }
            }
        }
    }

    const contracts = {
        customEvents: { producers: new Map(), consumers: new Map() },
        postMessages: { producers: new Map(), consumers: new Map() },
        runtimeMessages: { producers: new Map(), consumers: new Map() },
    };
    const storage = { readers: new Map(), writers: new Map() };
    for (const [file, text] of sources) {
        extractContracts(file, text, contracts);
        extractStorage(file, text, storage);
    }
    for (const [kind, pair] of Object.entries(contracts)) {
        for (const [name, files] of pair.producers) {
            if (!pair.consumers.has(name)) warnings.push(`${kind} ${name}: producer(s) ${[...files].join(', ')} have no statically proven consumer`);
        }
        for (const [name, files] of pair.consumers) {
            if (!pair.producers.has(name)) warnings.push(`${kind} ${name}: consumer(s) ${[...files].join(', ')} have no statically proven producer`);
        }
    }

    const referenced = new Set(edges.map(edge => edge.to));
    for (const file of jsFiles) if (!referenced.has(file)) warnings.push(`${file}: no manifest/HTML/literal runtime loader reference found`);

    const report = {
        root,
        summary: { productionJs: jsFiles.length, htmlPages: htmlFiles.length, edges: edges.length },
        errors: [...new Set(errors)].sort(),
        warnings: [...new Set(warnings)].sort(),
        edges,
        globals: Object.fromEntries([...globals].map(([file, names]) => [file, [...names].sort()])),
        contracts: Object.fromEntries(Object.entries(contracts).map(([kind, pair]) => [kind, {
            producers: serializeMap(pair.producers), consumers: serializeMap(pair.consumers),
        }])),
        storage: { readers: serializeMap(storage.readers), writers: serializeMap(storage.writers) },
    };
    return report;
}

function explainFile(report, requested) {
    const file = posix(path.relative(report.root, path.resolve(report.root, requested)));
    const incoming = report.edges.filter(edge => edge.to === file);
    const outgoing = report.edges.filter(edge => edge.from === file);
    const contracts = [];
    for (const [kind, pair] of Object.entries(report.contracts)) {
        for (const role of ['producers', 'consumers']) {
            for (const [name, files] of Object.entries(pair[role])) if (files.includes(file)) contracts.push(`${kind}.${role}: ${name}`);
        }
    }
    const storage = [];
    for (const role of ['readers', 'writers']) {
        for (const [key, files] of Object.entries(report.storage[role])) if (files.includes(file)) storage.push(`${role}: ${key}`);
    }
    return { file, incoming, outgoing, globals: report.globals[file] || [], contracts, storage };
}

function main(argv = process.argv.slice(2)) {
    const root = path.resolve(__dirname, '..');
    const report = analyzeProject(root);
    const explainIndex = argv.indexOf('--explain');
    if (argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
    else if (explainIndex !== -1) console.log(JSON.stringify(explainFile(report, argv[explainIndex + 1]), null, 2));
    else {
        console.log(`DashBridge dependency contracts: ${report.summary.productionJs} JS, ${report.summary.htmlPages} pages, ${report.summary.edges} load edges`);
        for (const error of report.errors) console.error(`[ERROR] ${error}`);
        for (const warning of report.warnings) console.warn(`[WARN] ${warning}`);
        if (!report.errors.length) console.log(`[OK] Dependency contracts passed (${report.warnings.length} advisory warnings)`);
    }
    if (report.errors.length) process.exitCode = 1;
    return report;
}

if (require.main === module) main();

module.exports = { analyzeProject, explainFile, extractDynamicReferences, extractHtml, localReference };
