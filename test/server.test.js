import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import WebSocket from 'ws';

test('HTTP and two-person room synchronization', { timeout: 15000 }, async () => {
  const child = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: '0' }, stdio:['ignore','pipe','pipe'] });
  const clients = [];
  try {
    const [output] = await once(child.stdout,'data');
    const port = output.toString().match(/port (\d+)/)[1];
    assert.equal((await fetch(`http://localhost:${port}`)).status,200);
    assert.equal((await fetch(`http://localhost:${port}/secret`)).status,404);
    async function client() {
      const ws = new WebSocket(`ws://localhost:${port}`); clients.push(ws);
      await once(ws,'open'); return ws;
    }
    function message(ws, data) { const next = once(ws,'message').then(([raw])=>JSON.parse(raw)); ws.send(JSON.stringify(data)); return next; }
    const a = await client();
    const room = 'a'.repeat(32);
    assert.equal((await message(a,{type:'join',room})).members,1);
    const b = await client();
    assert.equal((await message(b,{type:'join',room})).members,2);
    const incoming = once(b,'message').then(([raw])=>JSON.parse(raw));
    const source = await message(a,{type:'source',source:'https://example.com/song.mp3'});
    assert.equal(source.source,'https://example.com/song.mp3');
    assert.equal((await incoming).source,source.source);
    const control = await message(b,{type:'control',playing:true,position:12});
    assert.equal(control.playing,true); assert.equal(control.position,12);
    const c = await client();
    assert.equal((await message(c,{type:'join',room})).type,'error');
    const separate = await message(c,{type:'join',room:'b'.repeat(32)});
    assert.equal(separate.source,''); assert.equal(separate.members,1);
  } finally { for (const ws of clients) ws.terminate(); child.kill(); }
});
