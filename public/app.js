const socket = io();

let tournament = null;
let adminPin = "";
let isAdmin = false;
let lastAnimatedMatch = "";

const $ = id => document.getElementById(id);

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function showMessage(message, isError = false) {
  const box = $("admin-message");
  box.textContent = message;
  box.style.color = isError ? "#ff8585" : "#8df0b0";
}

function toast(message) {
  const box = $("toast");
  box.textContent = message;
  box.classList.add("show");

  setTimeout(() => box.classList.remove("show"), 3000);
}

async function api(url, method = "GET", data = {}) {
  const options = {
    method,
    headers: {
      "Content-Type": "application/json"
    }
  };

  if (isAdmin) {
    options.headers["x-admin-pin"] = adminPin;
  }

  if (method !== "GET") {
    options.body = JSON.stringify(data);
  }

  const response = await fetch(url, options);
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || "Request failed.");
  }

  return result;
}

function setAdmin(enabled) {
  isAdmin = enabled;

  $("admin-login").classList.toggle("hidden", enabled);
  $("admin-controls").classList.toggle("hidden", !enabled);

  if (!enabled) {
    adminPin = "";
    $("admin-pin").value = "";
    $("winner-controls").classList.add("hidden");
  }

  if (tournament) render(tournament);
}

// Verify Admin PIN
$("login-button").addEventListener("click", async () => {
  const pin = $("admin-pin").value.trim();

  if (!pin) {
    toast("Enter Admin PIN.");
    return;
  }

  try {
    const response = await fetch("/api/admin-check", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-pin": pin
      },
      body: "{}"
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Incorrect PIN.");
    }

    adminPin = pin;
    setAdmin(true);
    toast("Admin unlocked.");

  } catch (error) {
    toast(error.message);
  }
});

$("logout-button").addEventListener("click", () => {
  setAdmin(false);
  toast("Admin locked.");
});

// Save player list
$("save-players").addEventListener("click", async () => {
  const names = $("player-input").value
    .split("\n")
    .map(name => name.trim())
    .filter(Boolean);

  try {
    await api("/api/players", "POST", { names });
    showMessage("Players saved successfully.");
    toast("Tournament players updated.");
  } catch (error) {
    showMessage(error.message, true);
  }
});

// Spin
$("spin-button").addEventListener("click", async () => {
  try {
    await api("/api/spin", "POST");
    showMessage("Spin started!");
  } catch (error) {
    showMessage(error.message, true);
  }
});

// Reset
$("reset-button").addEventListener("click", async () => {
  if (!confirm("Are you sure you want to reset the tournament?")) {
    return;
  }

  try {
    await api("/api/reset", "POST");
    $("player-input").value = "";
    showMessage("Tournament reset successfully.");
    toast("Tournament reset.");
  } catch (error) {
    showMessage(error.message, true);
  }
});

// Select winner
async function selectWinner(name) {
  try {
    await api("/api/winner", "POST", { winner: name });
    showMessage(`${name} recorded as match winner.`);
    toast("Match result saved.");
  } catch (error) {
    showMessage(error.message, true);
  }
}

$("win1").addEventListener("click", () => {
  if (tournament?.current?.[0]) {
    selectWinner(tournament.current[0]);
  }
});

$("win2").addEventListener("click", () => {
  if (tournament?.current?.[1]) {
    selectWinner(tournament.current[1]);
  }
});

// 5-second vertical name-card animation
function animateMatch(data) {
  const first = $("name1");
  const second = $("name2");
  const box1 = $("p1");
  const box2 = $("p2");

  if (!data.current || data.current.length !== 2) return;

  const names = data.players || [];

  box1.classList.add("rolling");
  box2.classList.add("rolling");

  const interval = setInterval(() => {
    first.textContent =
      names[Math.floor(Math.random() * names.length)] || "???";

    second.textContent =
      names[Math.floor(Math.random() * names.length)] || "???";
  }, 100);

  setTimeout(() => {
    clearInterval(interval);

    first.textContent = data.current[0];
    second.textContent = data.current[1];

    box1.classList.remove("rolling");
    box2.classList.remove("rolling");
  }, 5000);
}

function render(data) {
  tournament = data;

  $("status").textContent =
    data.status === "finished" ? "FINISHED" :
    data.status === "match" ? "LIVE MATCH" :
    data.status === "ready" ? "READY" : "WAITING";

  $("round").textContent = data.round || 1;
  $("remaining").textContent = (data.remaining || []).length;

  $("last-winner").textContent =
    data.lastWinner || "Not decided yet";

  const current = data.current || [];

  if (current.length === 2) {
    $("match-message").textContent =
      `Round ${data.round}: Match in progress`;

    $("win1").textContent = `Winner: ${current[0]}`;
    $("win2").textContent = `Winner: ${current[1]}`;

    $("winner-controls").classList.toggle("hidden", !isAdmin);
  } else {
    $("winner-controls").classList.add("hidden");

    $("match-message").textContent =
      data.status === "finished"
        ? "Tournament completed!"
        : data.lastWinner
          ? `${data.lastWinner} is waiting for the next challenger.`
          : "Waiting for the first spin.";
  }

  if (!current.length) {
    $("name1").textContent = "Waiting...";
    $("name2").textContent = "Waiting...";
  }

  if (current.length === 2) {
    const matchKey = `${data.round}-${current[0]}-${current[1]}`;

    if (matchKey !== lastAnimatedMatch) {
      lastAnimatedMatch = matchKey;

      $("name1").textContent = "Ready...";
      $("name2").textContent = "Ready...";

      animateMatch(data);
    }
  }

  const championSection = $("champion-section");

  if (data.status === "finished" && data.champion) {
    championSection.classList.remove("hidden");
    $("champion-name").textContent = data.champion;
  } else {
    championSection.classList.add("hidden");
  }

  $("remaining-list").innerHTML =
    (data.remaining || []).map(name =>
      `<li>${escapeHTML(name)}</li>`
    ).join("") || "<li>None</li>";

  $("eliminated-list").innerHTML =
    (data.eliminated || []).map(name =>
      `<li>${escapeHTML(name)}</li>`
    ).join("") || "<li>None</li>";

  const history = [...(data.history || [])].reverse();

  $("history-list").innerHTML = history.length
    ? history.map(item => `
      <div class="history-item">
        <div>
          <span class="round-label">ROUND ${item.round}</span>
          <strong>${escapeHTML(item.player1)}</strong>
          <span class="versus-small">VS</span>
          <strong>${escapeHTML(item.player2)}</strong>
        </div>
        <div class="history-result">
          <span class="winner-text">Winner: ${escapeHTML(item.winner)}</span>
          <span class="loser-text">Eliminated: ${escapeHTML(item.loser)}</span>
        </div>
      </div>
    `).join("")
    : "No matches played yet.";

  if (isAdmin && data.players) {
    $("player-input").value = data.players.join("\n");
  }
}

// Live updates
socket.on("state", render);

socket.on("app-error", data => {
  toast(data.message || "Connection error.");
});

socket.on("connect", () => {
  console.log("Connected to tournament server.");
});

socket.on("disconnect", () => {
  console.log("Disconnected. Reconnecting...");
});

// Initial state
api("/api/state")
  .then(render)
  .catch(error => toast(error.message));
