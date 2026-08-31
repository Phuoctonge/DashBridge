'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'pages', 'dashbridge', 'dashbridge-profile-controller.js'), 'utf8');
assert(source.includes("const TAB_ACTIVE_PROFILE_KEY = 'dashbridge_tab_activeProfileId';")
    && source.includes('sessionStorage.getItem(TAB_ACTIVE_PROFILE_KEY)')
    && source.includes('sessionStorage.setItem(TAB_ACTIVE_PROFILE_KEY, normalized)'),
    'each DashBridge tab must own its active profile selection');

const syncStart = source.indexOf('const syncProfilesFromStorage = async () => {');
const syncEnd = source.indexOf("chrome.storage.onChanged.addListener((changes, areaName) => {", syncStart);
const sync = source.slice(syncStart, syncEnd);
assert(sync.includes('nextProfiles.some(profile => profile.id === activeProfileId)')
    && sync.includes('? activeProfileId')
    && sync.includes('setTabActiveProfileId(nextActiveProfileId);'),
    'profile synchronization must preserve the current tab selection while that profile still exists');
assert(source.includes('setTabActiveProfileId(id);')
    && source.includes('setTabActiveProfileId(newProfile.id);'),
    'profile switches and newly created profiles must update only the tab session selection');
console.log('PASS DashBridge tabs keep independent active profiles while sharing profile data');
