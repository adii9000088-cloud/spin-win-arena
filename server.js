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
    defender: null,
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

// Load saved tournament
function loadState() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      state = fresh();
      return;
    }

    const saved = JSON.parse(
      fs.readFileSync(DATA_FILE, "utf8")
    );

    const lastUpdate = Number(saved.updatedAt || 0);

    if (
      !lastUpdate ||
      Date.now() - lastUpdate >= RETENTION_MS
    ) {
      state = fresh();
      save();
      return;
    }

    state = {
      ...fresh(),
      ...saved
    };

  } catch (error) {
    console.error("Unable to load tournament:", error);
    state = fresh();
  }
}

// Save tournament
function save() {
  state.updatedAt = Date.now();

  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify(state, null, 2)
  );
}

// Check 7-day expiry
function expireIfNeeded() {
  const age = Date.now() - Number(state.updatedAt || 0);

  if (age >= RETENTION_MS) {
    state = fresh();
    save();
    io.emit("state", state);
  }
}

// Publish live state
function publish() {
  save();
  io.emit("state", state);
}

// Admin authentication
function admin(req, res, next) {
  const pin = req.get("x-admin-pin") || req.body.pin;

  if (pin !== ADMIN_PIN) {
    return res.status(401).json({
      error: "Admin PIN incorrect."
    });
  }

  next();
}

function asyncRoute(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Check expiry before API requests
app.use("/api", (req, res, next) => {
  expireIfNeeded();
  next();
});

// Public state
app.get("/api/state", (req, res) => {
  res.json(state);
});

// Verify Admin PIN
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

// Add players
app.post("/api/players", admin, (req, res) => {
  const names = Array.isArray(req.body.names)
    ? req.body.names.map(x => String(x).trim()).filter(Boolean)
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
    new Set(names.map(x => x.toLowerCase())).size !== names.length
  ) {
    return res.status(400).json({
      error: "Player names must be unique."
    });
  }

  state = {
    ...fresh(),
    players: names,
    remaining: [...names],
    status: "ready"
  };

  publish();

  res.json({
    ok: true,
    state
  });
});

// Spin tournament
app.post("/api/spin", admin, (req, res) => {
  if (state.status === "finished") {
    return res.status(400).json({
      error: "Tournament is finished."
    });
  }

  if (state.current.length) {
    return res.status(400).json({
      error: "Finish the current match first."
    });
  }

  // Next match: previous winner vs new challenger
  if (state.defender) {
    const challengers = state.remaining.filter(
      name => name !== state.defender
    );

    if (!challengers.length) {
      return res.status(400).json({
        error: "No challengers remain."
      });
    }

    const challenger = challengers[
      Math.floor(Math.random() * challengers.length)
    ];

    state.current = [
      state.defender,
      challenger
    ];

  } else {
    // First match: two random players
    if (state.remaining.length < 2) {
      return res.status(400).json({
        error: "Not enough players."
      });
    }

    const pool = [...state.remaining];

    const first = pool.splice(
      Math.floor(Math.random() * pool.length),
      1
    )[0];

    const second = pool.splice(
      Math.floor(Math.random() * pool.length),
      1
    )[0];

    state.current = [first, second];
  }

  state.status = "match";

  publish();

  res.json({
    ok: true,
    players: state.current,
    state
  });
});

// Record match winner
app.post("/api/winner", admin, (req, res) => {
  const winner = String(req.body.winner || "");

  if (
    state.current.length !== 2 ||
    !state.current.includes(winner)
  ) {
    return res.status(400).json({
      error: "Choose a player from the current match."
    });
  }

  const loser = state.current.find(
    name => name !== winner
  );

  const previousWinner = state.lastWinner;

  state.remaining = state.remaining.filter(
    name => name !== loser
  );

  if (!state.eliminated.includes(loser)) {
    state.eliminated.push(loser);
  }

  state.lastWinner = winner;
  state.defender = winner;

  state.history.push({
    round: state.round,
    player1: state.current[0],
    player2: state.current[1],
    previousWinner,
    winner,
    loser,
    at: new Date().toISOString()
  });

  state.current = [];

  // Only the final undefeated player becomes Champion
  if (state.remaining.length === 1) {
    state.champion = winner;
    state.defender = null;
    state.status = "finished";
  } else {
    state.champion = null;
    state.status = "ready";
    state.round += 1;
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

// Live visitors
io.on("connection", socket => {
  expireIfNeeded();
  socket.emit("state", state);
});

// Automatic expiry check every hour
setInterval(() => {
  expireIfNeeded();
}, 60 * 60 * 1000);

app.use((err, req, res, next) => {
  console.error(err);

  if (res.headersSent) {
    return next(err);
  }

  res.status(500).json({
    error: "Server error. Please try again."
  });
});

// Start server
loadState();

server.listen(PORT, () => {
  console.log(
    `Golgappy Club Knock Out Tournament running on port ${PORT}`
  );
});
