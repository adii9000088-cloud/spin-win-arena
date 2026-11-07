const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { Pool } = require("pg");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN;
const DATABASE_URL = process.env.DATABASE_URL;

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

if (!ADMIN_PIN || !DATABASE_URL) {
  console.error("Missing ADMIN_PIN or DATABASE_URL environment variable.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

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
    createdAt: new Date().toISOString()
  };
}

let state = fresh();

async function saveState() {
  await pool.query(
    `INSERT INTO tournament_state (id, data, updated_at)
     VALUES (1, $1::jsonb, NOW())
     ON CONFLICT (id)
     DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [JSON.stringify(state)]
  );
}

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tournament_state (
      id INTEGER PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const result = await pool.query(
    "SELECT data, updated_at FROM tournament_state WHERE id = 1"
  );

  if (result.rows.length) {
    const age =
      Date.now() - new Date(result.rows[0].updated_at).getTime();

    if (age >= RETENTION_MS) {
      state = fresh();
    } else {
      state = { ...fresh(), ...result.rows[0].data };
    }
  }

  await saveState();
}

async function expireIfNeeded() {
  const result = await pool.query(
    "SELECT updated_at FROM tournament_state WHERE id = 1"
  );

  if (!result.rows.length) return;

  const age =
    Date.now() - new Date(result.rows[0].updated_at).getTime();

  if (age >= RETENTION_MS) {
    state = fresh();
    await saveState();
    io.emit("state", state);
  }
}

async function publish() {
  await saveState();
  io.emit("state", state);
}

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

// Check 30-day expiry before API requests.
app.use("/api", asyncRoute(async (req, res, next) => {
  await expireIfNeeded();
  next();
}));

app.get("/api/state", (req, res) => {
  res.json(state);
});

// Reset tournament
app.post("/api/reset", admin, asyncRoute(async (req, res) => {
  state = fresh();
  await publish();

  res.json({ ok: true, state });
}));

// Add players
app.post("/api/players", admin, asyncRoute(async (req, res) => {
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

  if (new Set(names.map(x => x.toLowerCase())).size !== names.length) {
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

  await publish();

  res.json({ ok: true, state });
}));

// Spin: first match = two random players.
// Next matches = previous winner vs one new challenger.
app.post("/api/spin", admin, asyncRoute(async (req, res) => {
  if (state.status === "finished") {
    return res.status(400).json({
      error: "Tournament is already finished."
    });
  }

  if (state.current.length) {
    return res.status(400).json({
      error: "Finish the current match first."
    });
  }

  if (state.defender) {
    const challengers = state.remaining.filter(
      name => name !== state.defender
    );

    if (!challengers.length) {
      return res.status(400).json({
        error: "No challenger remains."
      });
    }

    const challenger =
      challengers[Math.floor(Math.random() * challengers.length)];

    state.current = [state.defender, challenger];

  } else {
    if (state.remaining.length < 2) {
      return res.status(400).json({
        error: "Not enough players."
      });
    }

    const poolNames = [...state.remaining];

    const first = poolNames.splice(
      Math.floor(Math.random() * poolNames.length), 1
    )[0];

    const second = poolNames.splice(
      Math.floor(Math.random() * poolNames.length), 1
    )[0];

    state.current = [first, second];
  }

  state.status = "match";

  await publish();

  res.json({
    ok: true,
    players: state.current,
    state
  });
}));

// Record match winner.
app.post("/api/winner", admin, asyncRoute(async (req, res) => {
  const winner = String(req.body.winner || "");

  if (
    state.current.length !== 2 ||
    !state.current.includes(winner)
  ) {
    return res.status(400).json({
      error: "Select a player from the current match."
    });
  }

  const loser = state.current.find(name => name !== winner);
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

  if (state.remaining.length === 1) {
    state.champion = winner;
    state.status = "finished";
    state.defender = null;
  } else {
    state.champion = null;
    state.status = "ready";
    state.round += 1;
  }

  await publish();

  res.json({
    ok: true,
    winner,
    eliminated: loser,
    champion: state.champion,
    finished: state.status === "finished",
    state
  });
}));

io.on("connection", async socket => {
  try {
    await expireIfNeeded();
    socket.emit("state", state);
  } catch (error) {
    socket.emit("app-error", {
      message: "Unable to load tournament state."
    });
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);

  res.status(500).json({
    error: "Server error. Please try again."
  });
});

initializeDatabase()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Golgappy Club Tournament running on port ${PORT}`);
    });
  })
  .catch(error => {
    console.error("Database initialization failed:", error);
    process.exit(1);
  });
