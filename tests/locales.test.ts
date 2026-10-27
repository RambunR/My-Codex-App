import {test} from 'node:test';
import assert from 'node:assert/strict';
import {baseMessages,localeMessages} from '../src/i18n';
import {LANGUAGES} from '../shared/config';

test('all 21 interface languages have complete nonempty message coverage',()=>{
  assert.equal(LANGUAGES.length,21);
  for(const language of LANGUAGES){const messages=localeMessages[language.code];assert.ok(messages,language.code);for(const key of Object.keys(baseMessages))assert.ok(typeof(messages as any)[key]==='string'&&(messages as any)[key].trim().length>0,`${language.code}: ${key}`);}
});
