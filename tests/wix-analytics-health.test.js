import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../api/wix-analytics-health.js', import.meta.url), 'utf8');

describe('Wix analytics health probe', () => {
  it('queries the Wix traffic semantic model with the configured site credentials', () => {
    assert.match(source, /cad7fd34-2c8b-4dda-8296-3f9d47fb484d/);
    assert.match(source, /process\.env\.WIX_API_KEY/);
    assert.match(source, /process\.env\.WIX_SITE_ID/);
    assert.match(source, /traffic\.sessions_count/);
    assert.match(source, /traffic\.visitors_count/);
    assert.match(source, /traffic\.views_count/);
    assert.match(source, /timezone:\s*"Europe\/London"/);
  });
});
