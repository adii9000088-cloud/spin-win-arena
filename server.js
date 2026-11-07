const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || "change-this-pin";
const DATA_FILE = path.join(__dirname, "tournament.json");

app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

const fresh = () => ({
  players: [],
  remaining: [],
  eliminated: [],
  current: [],
  champion: null,
  history: [],
  status: "waiting",
  round: 1
});

let state = fresh();

try {
  if (fs.existsSync(DATA_FILE)) {
    const loaded = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    state = { ...fresh(), ...loaded, eliminated: loaded.eliminated || [] };
  }
} catch (e) {}

function save() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

function publish() {
  save();
  io.emit("state", state);
}

function admin(req, res, next) {
  const pin = req.get("x-admin-pin") || req.body.pin;

  if (!ADMIN_PIN || pin !== ADMIN_PIN) {
    return res.status(401).json({ error: "Admin PIN incorrect" });
  }

  next();
}

app.get("/api/state", (req, res) => {
  res.json(state);
});

app.post("/api/reset", admin, (req, res) => {
  state = fresh();
  publish();
  res.json({ ok: true });
});

app.post("/api/players", admin, (req, res) => {
  const names = Array.isArray(req.body.names) ? req.body.names : [];
  const clean = names.map(x => String(x).trim()).filter(Boolean);

  if (clean.length < 2)
    return res.status(400).json({ error: "Add at least two player names." });

  if (clean.length > 256)
    return res.status(400).json({ error: "Maximum 256 players." });

  if (new Set(clean.map(x => x.toLowerCase())).size !== clean.length)
    return res.status(400).json({ error: "Player names must be unique." });

  state = {
    ...fresh(),
    players: clean,
    remaining: [...clean],
    status: "ready"
  };

  publish();
  res.json({ ok: true });
});

// FIRST SPIN: Select two random players.
// NEXT SPINS: Keep champion and select one new challenger.
app.post("/api/spin", admin, (req, res) => {
  if (state.status === "finished")
    return res.status(400).json({ error: "Tournament is finished." });

  if (state.current.length)
    return res.status(400).json({ error: "Finish the current match first." });

  if (state.champion) {
    const pool = state.remaining.filter(
      name => name !== state.champion
    );

    if (!pool.length)
      return res.status(400).json({
        error: "No challengers remain. The champion has won the tournament."
      });

    const challenger = pool[Math.floor(Math.random() * pool.length)];

    state.current = [state.champion, challenger];

  } else {
    if (state.remaining.length < 2)
      return res.status(400).json({ error: "Not enough players remain." });

    const pool = [...state.remaining];

    const a = pool.splice(
      Math.floor(Math.random() * pool.length), 1
    )[0];

    const b = pool.splice(
      Math.floor(Math.random() * pool.length), 1
    )[0];

    state.current = [a, b];
  }

  state.status = "match";

  publish();
  res.json({ ok: true, players: state.current });
});

// Record match winner and eliminate loser.
app.post("/api/winner", admin, (req, res) => {
  const winner = String(req.body.winner || "");

  if (
    state.current.length !== 2 ||
    !state.current.includes(winner)
  ) {
    return res.status(400).json({
      error: "Choose one of the two players in the current match."
    });
  }

  const previousChampion = state.champion;
  const loser = state.current.find(x => x !== winner);

  state.remaining = state.remaining.filter(x => x !== loser);

  if (!state.eliminated.includes(loser)) {
    state.eliminated.push(loser);
  }

  state.champion = winner;

  state.history.push({
    round: state.round,
    player1: state.current[0],
    player2: state.current[1],
    previousChampion,
    winner,
    loser,
    at: new Date().toISOString()
  });

  state.current = [];

  const challengers = state.remaining.filter(
    name => name !== state.champion
  );

  if (challengers.length === 0) {
    state.status = "finished";
  } else {
    state.round += 1;
    state.status = "ready";
  }

  publish();

  res.json({
    ok: true,
    champion: state.champion,
    eliminated: loser
  });
});

io.on("connection", socket => {
  socket.emit("state", state);
});

server.listen(PORT, () => {
  console.log(`Spin & Win Arena running on port ${PORT}`);
});
