'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const JSZip = require('../vendor/jszip.min.js');
const { webcrypto } = require('node:crypto');
const FROM = '1787774259463', TO = '1787791648851';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
function contextFor(ranges) {
    const elements = { dashUrl: {value:'https://grafana.example/d/uid/dashboard'},
        timestamps: {value:ranges.map(x=>`${x.from}, ${x.to}`).join('\n')},
        panelsMode:{value:'all'},userPanels:{value:''} };
    const c = { URL, URLSearchParams, Date, console, TextEncoder, Uint8Array, Blob, DOMException, AbortController,
        crypto:webcrypto, atob:value=>Buffer.from(value,'base64').toString('binary'), addEventListener(){},
        chrome:{storage:{sync:{get:async()=>({batchDetailedLogging:false})}}},
        document:{getElementById:id=>elements[id]||{checked:false},querySelector:()=>({dataset:{tab:'tab-main'}})},
        captureGrafanaPanelImage:async()=>({dataUrl:`data:image/png;base64,${PNG}`}) };
    c.globalThis=c; c.window=c; vm.createContext(c);
    for (const file of ['js/shared/grafana-time.js','js/shared/grafana-url.js',
        'pages/batch/batch-capture-utils.js','pages/batch/batch-operation-controller.js',
        'pages/batch/batch-main-run-controller.js','js/shared/confluence-report-schema.js',
        'pages/confluence-report/confluence-report-zip.js','pages/confluence-report/confluence-report-archive.js',
        'pages/confluence-report/confluence-report-preview.js']) {
        vm.runInContext(fs.readFileSync(file,'utf8'),c);
    }
    return {c,elements};
}
async function produceAndImport(ranges, rejected = false) {
    const {c,elements} = contextFor(ranges);
    const zip = new JSZip(); let active=true; let finalized=false; const queries=[]; const notifications=[];
    const archive={add:async(name,bytes)=>{zip.file(name,bytes)},finalize:async()=>{finalized=true}};
    const btn=()=>({style:{},addEventListener(){}});
    const operation=c.BatchOperationController.create({mainActionArea:btn(),startButton:btn(),
        startSeriesButton:btn(),cancelButton:btn(),showToast(){},logMessage(){},
        lifecycle:{begin:()=>1,isActive:()=>active,finish:()=>true,cancel:()=>{active=false}},
        progressFactory:{create:()=>({openPictureInPicture:async()=>{},update(){},finish(){},cancel(){},release:async()=>{}})},
        captureWindowRunner:{acquire:async()=>({id:1,tabs:[{id:2}]}),release:async()=>{}},
        loadPanel:async(_tab,url)=>{queries.push(url);return {w:1000,h:520}}});
    const controller=c.BatchMainRunController.create({startButton:btn(),operation,
        lifecycle:{signal:()=>new AbortController().signal},
        panelPicker:{getDashboardPanelsWithRecovery:async()=>({panels:{115:'RPS',138:'95 percentile'},panelList:[{id:115},{id:138}]})},
        panelRules:{load:async()=>({}),forPanel:()=>({})},captureUtils:vm.runInContext('BatchCaptureUtils',c),
        parseUrl:c.parseGrafanaDashboardUrl,
        normalizeRangesField:()=>c.normalizeGrafanaTimeRanges(elements.timestamps.value),
        getCaptureTheme:()=> 'light',updateProgress(){},showToast:(...args)=>notifications.push(args),logMessage(){},
        buildPanelUrl:c.buildGrafanaPanelUrl,createArchive:()=>archive,documentRef:c.document});
    await controller.run();
    if (rejected) {
        assert.equal(finalized,false);
        assert.equal(queries.length,0,'invalid period must be rejected before opening any capture URL');
        assert(notifications.some(item=>item[1]==='error'));
        return;
    }
    assert.equal(finalized,true);
    const bytes=await zip.generateAsync({type:'uint8array'});bytes.name='recheck.zip';bytes.size=bytes.length;
    const imported=await c.DashBridgeConfluenceReportZip.create({JSZip,schema:c.DashBridgeConfluenceReportSchema})
        .load(bytes,new AbortController().signal);
    const analyzed=c.DashBridgeConfluenceReportArchive.analyze(imported);
    const snapshot={tests:[{testKey:'test',title:'Test',groups:[{title:'Requests',images:[{captionLead:'RPS',occurrence:0,imageReference:{filename:'existing.png'}}]}]}]};
    const planned=c.DashBridgeConfluenceReportPreview.plan(snapshot,imported,{metric:'RPS'});
    const plannedCapture = planned.find(x => x.source)?.capture;
    return {c,queries,manifest:imported.manifest,analyzed,planned:plannedCapture};
}
(async () => {
    const single = await produceAndImport([{from:FROM,to:TO}]);
    assert.equal(single.analyzed.ranges.length,1,'one period must remain one group');
    assert.equal(single.analyzed.ranges[0].panels.length,2);
    assert.equal(single.planned.from,FROM);
    assert.equal(single.planned.to,TO);
    assert.equal(single.planned.panelTitle,'RPS');
    assert(single.manifest.captures.every(x=>x.rangeIndex===0 && x.file.includes('/') && x.from===FROM && x.to===TO));
    // Neither the PNG name nor its folder is required to reconstruct the period.
    const opaque = {...single, manifest: {...single.manifest, captures: single.manifest.captures.map((capture,index)=>({...capture,file:`opaque-${index}.png`}))}, sources: new Map()};
    opaque.manifest.captures.forEach((capture,index)=>opaque.sources.set(capture.file,{path:capture.file,blob:new Blob([String(index)])}));
    const opaqueAnalysis = single.c.DashBridgeConfluenceReportArchive.analyze(opaque);
    assert.equal(opaqueAnalysis.ranges.length,1);
    assert.equal(opaqueAnalysis.ranges[0].panels[0].from,FROM);
    const target = {tests:[{testKey:'test',groups:[{title:'Requests',images:[{captionLead:'RPS',occurrence:0}]}]}]};
    const opaquePreview = single.c.DashBridgeConfluenceReportPreview.plan(target,opaque,{metric:'RPS'});
    assert.equal(opaquePreview[0].capture.to,TO);
    const repeated = await produceAndImport([{from:FROM,to:TO},{from:FROM,to:TO}]);
    assert.equal(repeated.analyzed.ranges.length,2,'equal periods entered twice are separate occurrences');
    assert(repeated.analyzed.ranges.every(x=>x.panels.length===2));
    await produceAndImport([{from:TO,to:FROM}],true);
    console.log('PASS Batch ZIP to Confluence period metadata integration');
})().catch(e=>{console.error(e);process.exitCode=1});
