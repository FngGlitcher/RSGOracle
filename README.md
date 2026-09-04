# GTA Tunables Monitor

A configurable watcher inspired by the public GTAV-Tunables workflow. It supports:

- GTA V / GTA VI endpoint monitoring.
- PC, PlayStation and Xbox targets through configuration.
- `First seen` detection for endpoints that were previously unavailable.
- `Last-Modified`, ETag, Content-Length and SHA-256 tracking.
- AES-ECB tunables decryption using the same public key mechanism as the reference project.
- JOAAT-based tunable/context resolution.
- Current decrypted/resolved JSON.
- Full per-version history.
- Markdown changelogs with added/changed/removed entries.
- Optional Discord DM notifications.
- GitHub Actions polling every 30 minutes.
- All secrets stored in GitHub Actions Secrets.

## Setup

1. Create a new GitHub repository and copy this project.
2. Add repository secrets:
   - `DISCORD_BOT_TOKEN`
   - `DISCORD_USER_ID`
   - optionally `TUNABLES_AES_KEY` if you want to override the public reference key.
3. Review `config/config.json`.
4. Enable/disable titles, platforms and features there.
6. Run locally with Node.js 20+:

```bash
npm install
npm run check
npm test
npm start
```

## Discord

The bot sends a DM to `DISCORD_USER_ID`. The bot token is never stored in `config/config.json`.

Notification types:

- `Tunables GTA5 PS5 Updated`
- `Tunables GTA6 PS5 First seen`
- `Tunables ... Available Again`

The update message includes `Last-Modified` and a GitHub link to the generated changelog.

## History

Every processed version is stored below:

```text
history/<title>/<platform>/<timestamp>_<title>_<platform>_<asset>.json
```

Metadata is stored beside it with the same timestamp.

## First Seen

A configured target can start as a non-200 endpoint. It remains in `unavailable` state without a notification.

When it returns HTTP 200 for the first time:

1. `first_seen` is recorded.
2. The payload enters the normal download/decrypt/resolve pipeline.
3. History and changelog are created.
4. A Discord First Seen DM is sent.

After that, later content changes are treated as normal updates.

## Important note about endpoint formats

The exact platform path is configurable. For example, the included GTA VI examples use `PS5` and `PS6`, while GTA V legacy endpoints can use their existing path names.

If Rockstar changes an endpoint or format, update only `config/config.json` where possible.

## Reference

The original public project uses a platform list in `src/config.js`, AES-ECB decryption, JOAAT dictionaries and a post-decryption resolver. This implementation keeps those concepts but adds configurable targets, state, history, diffs and notifications.
