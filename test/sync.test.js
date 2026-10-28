import test from 'node:test';
import assert from 'node:assert/strict';
import { position, validSource } from '../sync.js';
test('advances a playing snapshot using server elapsed time', () => assert.equal(position({position:10,playing:true,updatedAt:1000},3500),12.5));
test('paused snapshot stays still and negative elapsed time is clamped', () => {
  assert.equal(position({position:10,playing:false,updatedAt:1000},3500),10);
  assert.equal(position({position:10,playing:true,updatedAt:1000},500),10);
});
test('accepts direct HTTP URLs and rejects executable schemes', () => {
  assert.equal(validSource('https://example.com/song.mp3'),true);
  for (const value of ['javascript:alert(1)','file:///secret','broken',null]) assert.equal(validSource(value),false);
});
