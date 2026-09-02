#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'icons', 'icon-update.svg'), 'utf8');

(async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        for (const size of [16, 48, 128]) {
            const page = await browser.newPage({ viewport: { width: size, height: size } });
            await page.setContent(`<style>html,body{margin:0;width:${size}px;height:${size}px}</style>${svg}`);
            await page.locator('svg').evaluate((element, pixels) => {
                element.setAttribute('width', pixels);
                element.setAttribute('height', pixels);
            }, size);
            await page.screenshot({
                path: path.join(root, 'icons', `icon${size}-update.png`),
                omitBackground: true,
            });
            await page.close();
        }
    } finally {
        await browser.close();
    }
    console.log('Generated update action icons: 16, 48 and 128 px');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
