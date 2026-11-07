const $ = id => document.getElementById(id);

let state = null;
const socket = io();

function pin() {
  return $("pin").value.trim();
}

async function api(path, body = {}) {
  const r = await fetch("/api/" + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-pin": pin()
    },
    body: JSON.stringify(body)
  });

  const data = await r.json();

  if (!r.ok) throw new Error(data.error || "Request failed");

  return data;
}

function notice(msg, isError = false) {
  $("notice").textContent = msg;
  $("notice").style.color = isError ? "#ff9c9c" : "#9aabc6";
}

function playerCard(id, name) {
  $(id).querySelector("strong").textContent = name || "—";
}

function esc(x) {
  return String(x).replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

function render(s) {
  state = s;

  $("round").textContent =
    s.status === "finished"
      ? "TOURNAMENT COMPLETE"
      : `ROUND ${s.round || 1}`;

  $("status").textContent =
    s.status === "finished"
      ? "CHAMPION CROWNED"
      : s.current.length
        ? "MATCH IN PROGRESS"
        : s.champion
          ? "CHAMPION WAITING FOR CHALLENGER"
          : s.remaining.length
            ? "READY FOR FIRST SPIN"
            : "WAITING FOR PLAYERS";

  playerCard("p1", s.current[0]);
  playerCard("p2", s.current[1]);

  $("count").textContent =
    s.remaining.filter(n => n !== s.champion).length;

  const challengers = s.remaining.filter(
    n => n !== s.champion
  );

  $("players").innerHTML = challengers.length
    ? challengers.map(n =>
        `<span class="chip">${esc(n)}</span>`
      ).join("")
    : "No challengers waiting";

  $("eliminated").innerHTML =
    (s.eliminated || []).length
      ? s.eliminated.map(n =>
          `<span class="chip eliminated-chip">${esc(n)}</span>`
        ).join("")
      : "No eliminations yet";

  $("champion").classList.toggle("hidden", !s.champion);

  if (s.champion) {
    $("champion").querySelector("strong").textContent =
      s.champion;
  }

  $("history").innerHTML = s.history.length
    ? [...s.history].reverse().map(m =>
        `<div class="matchrow">
          <span class="loser">${esc(m.loser)}</span>
          <span>beat</span>
          <span class="winner">${esc(m.winner)} ✓</span>
        </div>`
      ).join("")
    : '<div class="empty">Matches will appear here as they happen.</div>';

  $("win1").disabled = !s.current.length;
  $("win2").disabled = !s.current.length;

  $("win1").textContent =
    s.current[0] ? `${s.current[0]} WON` : "PLAYER 1 WON";

  $("win2").textContent =
    s.current[1] ? `${s.current[1]} WON` : "PLAYER 2 WON";

  $("spin").disabled =
    !!s.current.length ||
    s.status === "finished" ||
    (s.champion
      ? s.remaining.filter(n => n !== s.champion).length < 1
      : s.remaining.length < 2);

  $("p1").querySelector("small").textContent =
    s.champion ? "DEFENDING CHAMPION" : "PLAYER 1";

  $("p2").querySelector("small").textContent =
    s.champion ? "CHALLENGER" : "PLAYER 2";

  $("spin").textContent =
    s.champion
      ? "🎡 SPIN NEW CHALLENGER"
      : "🎡 SPIN FOR FIRST MATCH";
}

socket.on("state", render);

fetch("/api/state")
  .then(r => r.json())
  .then(render);

$("add").onclick = async () => {
  try {
    const names = $("names").value.split(/\r?\n/);
    await api("players", { names });
    notice("Players added. Share this page with spectators.");
  } catch (e) {
    notice(e.message, true);
  }
};

$("spin").onclick = async () => {
  try {
    notice("Spinning…");
    await api("spin");
    notice("Match selected. Play the match, then record the winner.");
  } catch (e) {
    notice(e.message, true);
  }
};

$("win1").onclick = () => winner(0);
$("win2").onclick = () => winner(1);

async function winner(i) {
  try {
    await api("winner", {
      winner: state.current[i]
    });

    notice("Winner stays as champion. Loser eliminated.");
  } catch (e) {
    notice(e.message, true);
  }
}

$("reset").onclick = async () => {
  if (!confirm("Reset the entire tournament?")) return;

  try {
    await api("reset");
    notice("Tournament reset.");
  } catch (e) {
    notice(e.message, true);
  }
};
