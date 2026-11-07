# Spin & Win Arena

A public, mobile-friendly tournament page. Spectators do not need accounts or logins. The admin controls are protected by a PIN. All connected viewers see the same tournament state live.

## Features
- Admin adds one player per line.
- Randomly spins two different remaining players for each match.
- Admin records the real match winner.
- Winner qualifies; loser is removed and cannot be drawn again.
- Live public player list, match history, and champion display.
- Tournament state is saved in `tournament.json`.

## Run locally
1. Install Node.js 18 or newer.
2. In this folder run `npm install`.
3. Set a private admin PIN, then run:
   - macOS/Linux: `ADMIN_PIN='your-private-pin' npm start`
   - Windows PowerShell: `$env:ADMIN_PIN='your-private-pin'; npm start`
4. Open `http://localhost:3000`.

## Make it public
Deploy this Node.js project to a host that supports persistent Node apps and WebSockets (for example, Render, Railway, or a VPS). Set:
- `ADMIN_PIN` to a long private PIN
- `PORT` is normally supplied by the host

Share the deployed public URL with spectators. They can watch without logging in. Only give the admin PIN to the person operating the tournament.

## Important hosting note
Use a host with a persistent disk/volume for `tournament.json`, or add a database before using an ephemeral deployment. Without persistent storage, tournament data may reset when the service restarts. Keep the admin PIN secret. This starter app is intended for a trusted small event; for a large public event, add stronger admin authentication and request protection.
