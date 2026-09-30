import test from 'node:test';
import assert from 'node:assert/strict';
import { speechLanguage } from '../speech-language.js';

test('Hindi script and Latin-script Hinglish get the Hindi voice; English stays English', () => {
  assert.equal(speechLanguage('TES4-2 पर कमेंट पोस्ट हो गया।'), 'hi');
  assert.equal(speechLanguage('TES4-2 par comment post ho gaya hai. Aur kuch karna hai?'), 'hi');
  assert.equal(speechLanguage('Haan, isko Under Review mein move kar diya.'), 'hi');
  assert.equal(speechLanguage('I moved TES4-3 to Under Review. Do you want to open the board?'), 'en');
  assert.equal(speechLanguage('The release is on par with the plan.'), 'en', 'one Hindi-looking word is not Hinglish');
  assert.equal(speechLanguage(''), 'en');
});
