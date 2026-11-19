// Guards on the production service's scope (Notion 4.4d section 2).
// No network: imports configuration and source text only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHANNELS, MAX_PER_RUN, MIN_LEAD_MINUTES } from '../lib/config.js';

test('only the four social platforms have Buffer channels', () => {
  assert.deepEqual(Object.keys(CHANNELS).sort(), ['Facebook', 'Instagram', 'LinkedIn', 'X']);
});

test('Substack is never a production channel', () => {
  for (const name of Object.keys(CHANNELS)) assert.doesNotMatch(name, /substack/i);
});

test('the sweep selects records only by those channels', () => {
  const src = readFileSync(new URL('../api/produce-sweep.js', import.meta.url), 'utf8');
  assert.match(src, /Object\.keys\(CHANNELS\)\.map\(p => `\{Platform\}='\$\{p\}'`\)/);
  assert.match(src, /\{Status\}='Approved',\{Pipeline Version\}='2\.0'/);
});

test('run limits are unchanged', () => {
  assert.equal(MAX_PER_RUN, 5);
  assert.equal(MIN_LEAD_MINUTES, 30);
});
