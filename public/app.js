const $ = id => document.getElementById(id);
const player = $('player');
let room = location.hash.slice(1);
if (!/^[a-f0-9]{32}$/.test(room)) { room = Array.from(crypto.getRandomValues(new Uint8Array(16)), x => x.toString(16).padStart(2,'0')).join(''); location.hash = room; }
let socket, state, offset = 0, samples = [], applyingUntil = 0, reconnect;
const say = text => $('message').textContent = text;
function send(message) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); else say('Reconnecting. Please try again once connected.'); }
function target() { return state.position + (state.playing ? Math.max(0, Date.now() + offset - state.updatedAt) / 1000 : 0); }
async function apply() {
  if (!state?.source || player.readyState < 1) return;
  applyingUntil = Date.now() + 600;
  const time = Math.min(target(), Number.isFinite(player.duration) ? player.duration : Infinity);
  if (Math.abs(player.currentTime - time) > 0.35) player.currentTime = time;
  if (state.playing) { try { await player.play(); } catch { say('Your browser needs a click: press Play together to enable playback.'); } }
  else player.pause();
}
function connect() {
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
  socket.onopen = () => { send({ type:'join',room }); ping(); };
  socket.onmessage = event => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'error') return say(msg.message);
    if (msg.type === 'pong') {
      const rtt = Date.now() - msg.sent;
      samples.push({ rtt, offset:msg.server - (msg.sent + rtt/2) }); samples = samples.slice(-10);
      offset = [...samples].sort((a,b)=>a.rtt-b.rtt)[0].offset; return;
    }
    if (msg.type !== 'state') return;
    state = msg; $('status').textContent = `${msg.members}/2 connected · synchronized room`;
    if (msg.source && player.getAttribute('src') !== msg.source) { player.src = msg.source; $('source').value = msg.source; }
    apply();
  };
  socket.onclose = () => { $('status').textContent = 'Reconnecting…'; clearTimeout(reconnect); reconnect = setTimeout(connect,1500); };
  socket.onerror = () => socket.close();
}
function ping() { send({type:'ping',sent:Date.now()}); }
function control(playing) { send({type:'control',playing,position:player.currentTime}); }
$('sourceForm').onsubmit = event => { event.preventDefault(); send({type:'source',source:$('source').value}); };
$('play').onclick = () => { if (!state?.source) return say('Load a direct media URL first.'); player.play().catch(()=>say('Unable to play this media. Check the URL and format.')); control(true); };
$('pause').onclick = () => control(false);
player.onloadedmetadata = apply;
player.onseeked = () => { if (Date.now() > applyingUntil) control(!player.paused); };
player.onplay = () => { if (Date.now() > applyingUntil) control(true); };
player.onpause = () => { if (Date.now() > applyingUntil && !player.ended) control(false); };
player.onerror = () => say('Media could not load. Use a publicly accessible direct media URL supported by your browser.');
$('invite').onclick = async () => { try { await navigator.clipboard.writeText(location.href); say('Invitation copied. Send it to your person.'); } catch { say(`Copy this invitation: ${location.href}`); } };
setInterval(() => { if (socket?.readyState === WebSocket.OPEN) { ping(); apply(); } },3000);
connect();
