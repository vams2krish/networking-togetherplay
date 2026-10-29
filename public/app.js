const $ = (id) => document.getElementById(id),
  player = $("player");
const random = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (x) =>
    x.toString(16).padStart(2, "0"),
  ).join("");
let room = location.hash.slice(1),
  socket,
  state,
  offset = 0,
  samples = [],
  rtt = 0,
  reconnect,
  attempt = 0,
  enabled = false,
  lastReady = null,
  stopped = false,
  applying = false;
if (room && !/^[a-f0-9]{32}$/.test(room)) {
  room = "";
  history.replaceState(null, "", location.pathname);
}
let token;
try {
  token = sessionStorage.getItem(`togetherplay:${room}`) || random();
} catch {
  token = random();
}
const say = (text) => ($("message").textContent = text);
const time = (value) => {
  value = Math.max(0, Number.isFinite(value) ? value : 0);
  return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
};
function send(msg) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(msg));
    return true;
  }
  return false;
}
function target() {
  return (
    state.position +
    (state.playing
      ? Math.max(0, Date.now() + offset - state.updatedAt) / 1000
      : 0)
  );
}
function ready(value, force = false) {
  if (!state?.source) return;
  if (force || lastReady !== value) {
    lastReady = value;
    send({ type: "ready", ready: value, sourceRevision: state.sourceRevision });
  }
}
function canControl() {
  return state && (!state.hostOnly || state.isHost);
}
function render() {
  $("role").textContent = state.isHost ? "Host" : "Partner";
  $("status").textContent = `${state.members}/2 connected`;
  $("presence").textContent = `${state.members} / 2`;
  $("readiness").textContent = `${state.ready} / ${state.members}`;
  $("hostOnly").checked = state.hostOnly;
  $("hostOnly").disabled = !state.isHost;
  for (const name of ["load", "demo", "source"])
    $(name).disabled = !canControl();
  for (const name of ["play", "pause", "seek"])
    $(name).disabled = !canControl() || !state.source;
  $("invite").disabled = false;
  $("expiry").textContent =
    `Private invitation · expires ${new Date(state.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  $("playback").textContent = state.playing
    ? "PLAYING TOGETHER"
    : state.requested
      ? "WAITING FOR EVERYONE"
      : "PAUSED TOGETHER";
  if (state.source) {
    $("mediaTitle").textContent = state.source.endsWith("/demo.wav")
      ? "An evening, together"
      : "Your shared soundtrack";
    $("mediaSubtitle").textContent = state.playing
      ? "Same song. Same moment."
      : state.requested
        ? "Waiting for audio and buffering readiness."
        : "A little closer, one play at a time.";
  }
}
async function apply() {
  if (!state?.source || player.readyState < 1) return;
  const t = Math.min(
    target(),
    Number.isFinite(player.duration) ? player.duration : Infinity,
  );
  applying = true;
  if (Math.abs(player.currentTime - t) > 0.35) player.currentTime = t;
  if (state.playing && enabled) {
    try {
      await player.play();
      if (!state.playing) player.pause();
    } catch {
      ready(false);
      say("Click Enable my audio to allow playback in this browser.");
    }
  } else player.pause();
  applying = false;
}
function connect() {
  if (stopped) return;
  socket = new WebSocket(
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ws`,
  );
  socket.onopen = () => {
    attempt = 0;
    samples = [];
    lastReady = null;
    send({ type: room ? "join" : "create", room, token });
    send({ type: "ping", sent: Date.now() });
  };
  socket.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "joined") {
      room = msg.room;
      history.replaceState(null, "", `#${room}`);
      try {
        sessionStorage.setItem(`togetherplay:${room}`, token);
      } catch {}
      say(
        "Invite your person, choose a track, and enable audio on both devices.",
      );
      return;
    }
    if (msg.type === "error") {
      say(msg.message);
      if (["expired", "full", "session"].includes(msg.code)) {
        stopped = true;
        socket.close();
        $("status").textContent = "Room unavailable";
      }
      return;
    }
    if (msg.type === "pong") {
      const elapsed = Date.now() - msg.sent;
      samples.push({
        rtt: elapsed,
        offset: msg.server - (msg.sent + elapsed / 2),
      });
      samples = samples.slice(-10);
      const best = [...samples].sort((a, b) => a.rtt - b.rtt)[0];
      offset = best.offset;
      rtt = elapsed;
      $("latency").textContent = `${Math.round(rtt)} ms`;
      return;
    }
    if (msg.type !== "state") return;
    const changed = state?.sourceRevision !== msg.sourceRevision;
    state = msg;
    if (!samples.length) offset = msg.serverNow - Date.now();
    if (changed && msg.source) {
      lastReady = null;
      player.src = msg.source;
      $("source").value = msg.source;
      player.load();
      say("Media loaded. Enable your audio, then press Play together.");
    }
    render();
    ready(enabled && player.readyState >= 3);
    apply();
  };
  socket.onclose = () => {
    player.pause();
    if (stopped) return;
    $("status").textContent = "Reconnecting…";
    for (const name of ["play", "pause", "load", "demo", "invite", "seek"])
      $(name).disabled = true;
    clearTimeout(reconnect);
    reconnect = setTimeout(
      connect,
      Math.min(15000, 750 * 2 ** attempt++) + Math.random() * 300,
    );
  };
  socket.onerror = () => socket.close();
}
function control(playing, position = player.currentTime) {
  if (canControl())
    send({
      type: "control",
      playing,
      position,
      sourceRevision: state.sourceRevision,
    });
}
$("enable").onclick = async () => {
  enabled = true;
  if (state?.source) {
    try {
      await player.play();
      if (!state.playing) player.pause();
      ready(player.readyState >= 3, true);
      say("Your audio is enabled. You are ready to listen together.");
    } catch {
      enabled = false;
      ready(false);
      say("Audio could not start. Check that the media can be played.");
    }
  } else say("Audio enabled for this session. Choose a track to get ready.");
  $("enable").textContent = enabled ? "✓ Audio enabled" : "Enable my audio";
};
$("play").onclick = async () => {
  if (!enabled) await $("enable").onclick();
  if (enabled) control(true);
};
$("pause").onclick = () => control(false);
$("sourceForm").onsubmit = (e) => {
  e.preventDefault();
  if (canControl()) send({ type: "source", source: $("source").value });
};
$("demo").onclick = () => send({ type: "source", source: "/demo.wav" });
$("hostOnly").onchange = () =>
  send({ type: "settings", hostOnly: $("hostOnly").checked });
$("seek").onchange = () => control(state.requested, Number($("seek").value));
$("volume").oninput = () => {
  player.volume = Number($("volume").value);
};
player.volume = 0.7;
player.oncanplay = () => {
  ready(enabled, true);
  apply();
};
player.onwaiting = () => {
  if (!applying) ready(false);
};
player.onloadedmetadata = () => {
  $("duration").textContent = time(player.duration);
  $("seek").max = Number.isFinite(player.duration) ? player.duration : 0;
  $("stageart").hidden = player.videoWidth > 0;
  apply();
};
player.onended = () => {
  ready(false);
  if (canControl()) control(false, player.duration);
};
player.onerror = () => {
  ready(false);
  say(
    "This media could not load. Try a direct HTTPS media file or the demo track.",
  );
};
$("invite").onclick = async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    say("Invitation copied. Send it to your person.");
  } catch {
    say(`Share this invitation: ${location.href}`);
  }
};
setInterval(() => {
  if (socket?.readyState === WebSocket.OPEN) {
    send({ type: "ping", sent: Date.now() });
    if (state?.source && player.readyState >= 1) {
      const drift = player.currentTime - target();
      $("drift").textContent = `${Math.round(drift * 1000)} ms`;
      send({ type: "telemetry", drift, rtt });
      apply();
    }
  }
}, 3000);
setInterval(() => {
  if (player.readyState >= 1) {
    $("elapsed").textContent = time(player.currentTime);
    if (document.activeElement !== $("seek"))
      $("seek").value = player.currentTime;
  }
}, 250);
window.addEventListener("offline", () => {
  player.pause();
  say("You are offline. Playback will reconnect when your connection returns.");
});
connect();
