const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN;

const DATA_FILE = path.join(__dirname, "tournament.json");
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

if (!ADMIN_PIN) {
  console.error("Missing ADMIN_PIN environment variable.");
  process.exit(1);
}

app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

function fresh() {
  return {
    players: [],
    remaining: [],
    eliminated: [],
    current: [],
    roundPlayers: [],
    roundPending: [],
    roundWinners: [],
    lastWinner: null,
    champion: null,
    history: [],
    status: "waiting",
    round: 1,
    createdAt: new Date().toISOString(),
    updatedAt: Date.now()
  };
}

let state = fresh();

// Save tournament data
function save() {
  state.updatedAt = Date.now();

  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify(state, null, 2)
  );
}

// Load tournament data
function loadState() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      state = fresh();
      save();
      return;
    }

    const saved = JSON.parse(
      fs.readFileSync(DATA_FILE, "utf8")
    );

    const age = Date.now() - Number(saved.updatedAt || 0);

    if (!saved.updatedAt || age >= RETENTION_MS) {
      state = fresh();
      save();
      return;
    }

    state = {
      ...fresh(),
      ...saved
    };

    state.roundPlayers ||= [...state.remaining];
    state.roundPending ||= [...state.remaining];
    state.roundWinners ||= [];

  } catch (error) {
    console.error("Tournament loading error:", error);
    state = fresh();
    save();
  }
}

// Seven-day inactivity expiry
function expireIfNeeded() {
  const age = Date.now() - Number(state.updatedAt || 0);

  if (age >= RETENTION_MS) {
    state = fresh();
    save();
    io.emit("state", state);
  }
}

// Send updates to all visitors
function publish() {
  save();
  io.emit("state", state);
}

// Admin PIN protection
function admin(req, res, next) {
  const pin = req.get("x-admin-pin") || req.body.pin;

  if (!pin || pin !== ADMIN_PIN) {
    return res.status(401).json({
      error: "Admin PIN incorrect."
    });
  }

  next();
}

// Shuffle player names
function shuffle(array) {
  const result = [...array];

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));

    [result[i], result[j]] = [
      result[j],
      result[i]
    ];
  }

  return result;
}

// Update players remaining
function updateRemaining() {
  state.remaining = state.players.filter(
    name => !state.eliminated.includes(name)
  );
}

// Finish round and prepare next round
function completeRound() {
  if (state.roundPending.length !== 0) {
    return;
  }

  const winners = [...state.roundWinners];

  if (winners.length === 1) {
    state.champion = winners[0];
    state.status = "finished";
    state.current = [];
    return;
  }

  if (winners.length < 1) {
    state.status = "waiting";
    return;
  }

  state.round += 1;
  state.roundPlayers = [...winners];
  state.roundPending = shuffle(winners);
  state.roundWinners = [];
  state.current = [];
  state.status = "ready";
}

// Give automatic BYE to one unpaired player
function resolveBye() {
  if (state.roundPending.length === 1) {
    const player = state.roundPending.shift();

    state.roundWinners.push(player);

    state.history.push({
      round: state.round,
      type: "bye",
      player1: player,
      player2: null,
      winner: player,
      loser: null,
      at: new Date().toISOString()
    });
  }

  completeRound();
}

// Expiry check before API requests
app.use("/api", (req, res, next) => {
  expireIfNeeded();
  next();
});

// Public tournament state
app.get("/api/state", (req, res) => {
  res.json(state);
});

// Admin login verification
app.post("/api/admin-check", admin, (req, res) => {
  res.json({ ok: true });
});

// Reset tournament
app.post("/api/reset", admin, (req, res) => {
  state = fresh();
  publish();

  res.json({
    ok: true,
    state
  });
});

// Add tournament players
app.post("/api/players", admin, (req, res) => {
  const names = Array.isArray(req.body.names)
    ? req.body.names
        .map(name => String(name).trim())
        .filter(Boolean)
    : [];

  if (names.length < 2) {
    return res.status(400).json({
      error: "Add at least two players."
    });
  }

  if (names.length > 256) {
    return res.status(400).json({
      error: "Maximum 256 players allowed."
    });
  }

  if (
    new Set(names.map(name => name.toLowerCase())).size
    !== names.length
  ) {
    return res.status(400).json({
      error: "Player names must be unique."
    });
  }

  const shuffled = shuffle(names);

  state = {
    ...fresh(),
    players: names,
    remaining: [...names],
    roundPlayers: [...shuffled],
    roundPending: [...shuffled],
    roundWinners: [],
    status: "ready"
  };

  publish();

  res.json({
    ok: true,
    state
  });
});

// Spin: select two players from current round
app.post("/api/spin", admin, (req, res) => {
  if (state.status === "finished") {
    return res.status(400).json({
      error: "Tournament is finished."
    });
  }

  if (state.current.length) {
    return res.status(400).json({
      error: "Record current match winner first."
    });
  }

  if (state.players.length < 2) {
    return res.status(400).json({
      error: "Add players first."
    });
  }

  resolveBye();

  if (state.status === "finished") {
    publish();

    return res.json({
      ok: true,
      champion: state.champion,
      state
    });
  }

  if (state.roundPending.length < 2) {
    return res.status(400).json({
      error: "No players available for another match."
    });
  }

  const player1 = state.roundPending.shift();
  const player2 = state.roundPending.shift();

  state.current = [player1, player2];
  state.status = "match";

  publish();

  res.json({
    ok: true,
    players: state.current,
    state
  });
});

// Record actual match winner
app.post("/api/winner", admin, (req, res) => {
  const winner = String(req.body.winner || "");

  if (
    state.current.length !== 2 ||
    !state.current.includes(winner)
  ) {
    return res.status(400).json({
      error: "Select a player from the current match."
    });
  }

  const player1 = state.current[0];
  const player2 = state.current[1];

  const loser = player1 === winner
    ? player2
    : player1;

  state.roundWinners.push(winner);
  state.lastWinner = winner;

  if (!state.eliminated.includes(loser)) {
    state.eliminated.push(loser);
  }

  state.history.push({
    round: state.round,
    type: "match",
    player1,
    player2,
    winner,
    loser,
    at: new Date().toISOString()
  });

  state.current = [];

  updateRemaining();

  // Resolve BYE and advance round if all matches are complete
  resolveBye();

  if (state.status !== "finished") {
    state.status = "ready";
  }

  publish();

  res.json({
    ok: true,
    winner,
    eliminated: loser,
    champion: state.champion,
    finished: state.status === "finished",
    state
  });
});

// Live visitor connection
io.on("connection", socket => {
  expireIfNeeded();
  socket.emit("state", state);
});

// Check expiry every hour
setInterval(() => {
  expireIfNeeded();
}, 60 * 60 * 1000);

// Error handling
app.use((err, req, res, next) => {
  console.error(err);

  if (res.headersSent) {
    return next(err);
  }

  res.status(500).json({
    error: "Server error. Please try again."
  });
});

// Start application
loadState();

server.listen(PORT, () => {
  console.log(
    `Golgappy Club Knock Out Tournament running on port ${PORT}`
  );
});
