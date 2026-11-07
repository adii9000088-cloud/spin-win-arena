const socket = io();

let tournament = null;
let adminPin = "";
let isAdmin = false;
let lastAnimatedMatch = "";

const $ = id => document.getElementById(id);

// Escape HTML to protect displayed player names
function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

// Toast notification
function toast(message) {
  const box = $("toast");

  box.textContent = message;
  box.classList.add("show");

  setTimeout(() => {
    box.classList.remove("show");
  }, 3000);
}

// Admin messages
function showMessage(message, error = false) {
  const box = $("admin-message");

  box.textContent = message;
  box.style.color = error ? "#ff8585" : "#8df0b0";
}

// API request helper
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

// Admin login
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
    isAdmin = true;

    $("admin-login").classList.add("hidden");
    $("admin-controls").classList.remove("hidden");

    if (tournament) {
      render(tournament);
    }

    toast("Admin unlocked.");

  } catch (error) {
    toast(error.message);
  }
});

// Admin logout
$("logout-button").addEventListener("click", () => {
  isAdmin = false;
  adminPin = "";

  $("admin-pin").value = "";

  $("admin-login").classList.remove("hidden");
  $("admin-controls").classList.add("hidden");
  $("winner-controls").classList.add("hidden");

  toast("Admin locked.");
});

// Save player names
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

// Spin button
$("spin-button").addEventListener("click", async () => {
  try {
    await api("/api/spin", "POST");

    showMessage("Spin started!");

  } catch (error) {
    showMessage(error.message, true);
  }
});

// Reset tournament
$("reset-button").addEventListener("click", async () => {
  if (!confirm("Are you sure you want to reset the tournament?")) {
    return;
  }

  try {
    await api("/api/reset", "POST");

    $("player-input").value = "";

    lastAnimatedMatch = "";

    showMessage("Tournament reset successfully.");

    toast("Tournament reset.");

  } catch (error) {
    showMessage(error.message, true);
  }
});

// Record winner
async function selectWinner(name) {
  try {
    await api("/api/winner", "POST", {
      winner: name
    });

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

// Five-second vertical name animation
function animateMatch(data) {
  const first = $("name1");
  const second = $("name2");

  const box1 = $("p1");
  const box2 = $("p2");

  if (!data.current || data.current.length !== 2) {
    return;
  }

  const names = data.players || [];

  if (!names.length) {
    return;
  }

  box1.classList.add("rolling");
  box2.classList.add("rolling");

  const interval = setInterval(() => {
    first.textContent =
      names[Math.floor(Math.random() * names.length)];

    second.textContent =
      names[Math.floor(Math.random() * names.length)];

  }, 100);

  setTimeout(() => {
    clearInterval(interval);

    first.textContent = data.current[0];
    second.textContent = data.current[1];

    box1.classList.remove("rolling");
    box2.classList.remove("rolling");

  }, 5000);
}

// Display round progress
function renderRoundProgress(data) {
  const box = $("round-progress");

  if (!data.players || !data.players.length) {
    box.textContent = "No tournament started yet.";
    return;
  }

  const winners = data.roundWinners || [];
  const pending = data.roundPending || [];
  const current = data.current || [];

  box.innerHTML = `
    <div class="progress-stats">
      <div>
        <span>ROUND</span>
        <strong>${data.round}</strong>
      </div>

      <div>
        <span>QUALIFIED</span>
        <strong>${winners.length}</strong>
      </div>

      <div>
        <span>WAITING</span>
        <strong>${pending.length}</strong>
      </div>
    </div>

    <h3>Qualified Players</h3>

    <ul>
      ${
        winners.map(name =>
          `<li>${escapeHTML(name)}</li>`
        ).join("") || "<li>No winners yet</li>"
      }
    </ul>

    ${
      current.length === 2
        ? `<p class="progress-live">
            Current match: ${escapeHTML(current[0])}
            VS ${escapeHTML(current[1])}
          </p>`
        : ""
    }
  `;
}

// Main render function
function render(data) {
  tournament = data;

  $("status").textContent =
    data.status === "finished"
      ? "FINISHED"
      : data.status === "match"
        ? "LIVE MATCH"
        : data.status === "ready"
          ? "READY"
          : "WAITING";

  $("round").textContent = data.round || 1;

  $("remaining").textContent =
    (data.remaining || []).length;

  $("qualified").textContent =
    (data.roundWinners || []).length;

  $("last-winner").textContent =
    data.lastWinner || "Not decided yet";

  const current = data.current || [];

  // Current match display
  if (current.length === 2) {
    $("match-message").textContent =
      `Round ${data.round}: Match in progress`;

    $("win1").textContent =
      `Winner: ${current[0]}`;

    $("win2").textContent =
      `Winner: ${current[1]}`;

    $("winner-controls").classList.toggle(
      "hidden",
      !isAdmin
    );

  } else {
    $("winner-controls").classList.add("hidden");

    $("match-message").textContent =
      data.status === "finished"
        ? "Tournament completed!"
        : data.roundPending?.length === 0
          ? "Round completed."
          : data.lastWinner
            ? `${data.lastWinner} won the previous match.`
            : "Waiting for the first spin.";
  }

  // Reset displayed names when no match is active
  if (!current.length) {
    $("name1").textContent = "Waiting...";
    $("name2").textContent = "Waiting...";

    $("p1").classList.remove("rolling");
    $("p2").classList.remove("rolling");
  }

  // Animate only once for each new match
  if (current.length === 2) {
    const matchKey =
      `${data.round}-${current[0]}-${current[1]}`;

    if (matchKey !== lastAnimatedMatch) {
      lastAnimatedMatch = matchKey;

      $("name1").textContent = "Ready...";
      $("name2").textContent = "Ready...";

      animateMatch(data);
    }
  }

  // Champion display
  if (data.status === "finished" && data.champion) {
    $("champion-section").classList.remove("hidden");

    $("champion-name").textContent = data.champion;

  } else {
    $("champion-section").classList.add("hidden");
  }

  // Remaining players
  $("remaining-list").innerHTML =
    (data.remaining || []).map(name =>
      `<li>${escapeHTML(name)}</li>`
    ).join("") || "<li>None</li>";

  // Eliminated players
  $("eliminated-list").innerHTML =
    (data.eliminated || []).map(name =>
      `<li>${escapeHTML(name)}</li>`
    ).join("") || "<li>None</li>";

  // Round progress
  renderRoundProgress(data);

  // Match history
  const history = [...(data.history || [])].reverse();

  $("history-list").innerHTML = history.length
    ? history.map(item => {

        if (item.type === "bye") {
          return `
            <div class="history-item">

              <div>
                <span class="round-label">
                  ROUND ${item.round}
                </span>

                <strong>
                  ${escapeHTML(item.winner)}
                </strong>

                <span class="bye-text">
                  BYE — Advanced
                </span>
              </div>

            </div>
          `;
        }

        return `
          <div class="history-item">

            <div>
              <span class="round-label">
                ROUND ${item.round}
              </span>

              <strong>
                ${escapeHTML(item.player1)}
              </strong>

              <span class="versus-small">VS</span>

              <strong>
                ${escapeHTML(item.player2)}
              </strong>
            </div>

            <div class="history-result">

              <span class="winner-text">
                Winner: ${escapeHTML(item.winner)}
              </span>

              <span class="loser-text">
                Eliminated: ${escapeHTML(item.loser)}
              </span>

            </div>

          </div>
        `;

      }).join("")
    : "No matches played yet.";

  // Keep player list available in Admin Panel
  if (isAdmin && data.players) {
    $("player-input").value =
      data.players.join("\n");
  }
}

// Receive live updates
socket.on("state", data => {
  render(data);
});

socket.on("connect", () => {
  console.log("Connected to tournament server.");
});

socket.on("disconnect", () => {
  console.log("Disconnected. Reconnecting...");
});

socket.on("app-error", data => {
  toast(data.message || "Connection error.");
});

// Initial state
api("/api/state")
  .then(render)
  .catch(error => {
    toast(error.message);
  });
