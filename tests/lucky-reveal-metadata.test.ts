import {test} from 'node:test';
import assert from 'node:assert/strict';
import {drawDate,seriesDate} from '../src/lucky-draw-utils';
import {luckyRevealEnglish,luckyRevealMessages} from '../src/lucky-reveal-locales';
import {LANGUAGES} from '../shared/config';
test('result-panel copy is complete in every interface language',()=>{for(const language of LANGUAGES){const messages=language.code==='en'?luckyRevealEnglish:luckyRevealMessages[language.code];assert.deepEqual(Object.keys(messages).sort(),Object.keys(luckyRevealEnglish).sort());for(const value of Object.values(messages))assert.ok(typeof value==='string'&&value.trim().length>0,language.code);}});
test('upload and draw dates interpret SQL timestamps as UTC and suppress missing/invalid values',()=>{const before=process.env.TZ;process.env.TZ='Asia/Hong_Kong';try{assert.equal(drawDate('2026-11-11 20:30:00','en-US'),drawDate('2026-11-11T20:30:00.000Z','en-US'));assert.match(drawDate('2026-11-11 20:30:00','en-US'),/Nov 12.*4:30/);assert.equal(seriesDate('2026-11-11T20:30:00.000Z','en-US'),'Nov 12, 2026');assert.equal(seriesDate(null,'en-US'),'');assert.equal(seriesDate('invalid','en-US'),'');assert.equal(drawDate('invalid','en-US'),'');}finally{if(before===undefined)delete process.env.TZ;else process.env.TZ=before;}});
