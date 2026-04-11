# Deployment & Operations

## Hosting

**Recommendation: Hetzner CAX11 ARM VPS** — EUR 3.79/mo (~$5), 2 vCPU, 4GB RAM, 40GB disk.

The workload is bursty outbound HTTP (LLM calls, twitterapi.io, Discord REST polling). Actual need: 1 vCPU, 512MB-1GB RAM, 10GB disk. Hetzner is overkill and still under $5/mo.

Alternatives: Fly.io, Railway — 2-3x more expensive, add platform-specific failure modes (volume migrations, ephemeral storage). A plain VPS with pm2 or systemd is simpler.

## Monthly Cost Estimate

| Component | Cost/mo |
|-----------|---------|
| Hetzner VPS | ~$5 |
| Domain | ~$1 |
| twitterapi.io | ~$9 |
| Anthropic API (Haiku + Sonnet) | ~$10-20 |
| **Total** | **~$25-35/mo** |

## Process Management

### Option A: pm2

```bash
# Install pm2 globally
npm install -g pm2

# Start Podders
pm2 start dist/index.js --name podders -- run

# Auto-restart on crash, save process list for reboot persistence
pm2 save
pm2 startup  # generates systemd/init script for auto-start on boot
```

`ecosystem.config.cjs` (optional, for pm2 config-as-code):

```js
module.exports = {
  apps: [{
    name: 'podders',
    script: 'dist/index.js',
    args: 'run',
    env_file: '.env',
    max_memory_restart: '512M',
    restart_delay: 5000,
  }],
};
```

### Option B: systemd

```ini
# /etc/systemd/system/podders.service
[Unit]
Description=Podders v2 — market intelligence engine
After=network.target

[Service]
Type=simple
User=podders
WorkingDirectory=/opt/podders
EnvironmentFile=/opt/podders/.env
ExecStart=/usr/bin/node dist/index.js run
Restart=always
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable podders
sudo systemctl start podders
```

### Health Check

```bash
# Cron-based health check (add to crontab)
* * * * * curl -sf http://localhost:3000/api/v1/status || systemctl restart podders
```

### Process Watchdog

The main process writes a heartbeat file (`/tmp/podders-heartbeat`) every 60s. An external watchdog checks file age and restarts the process if it goes stale (>300s). This catches hangs that pass the HTTP health check but stop doing real work.

**systemd watchdog** (add to `[Service]` section):

```ini
WatchdogSec=300
```

systemd sends `SIGABRT` if the watchdog timeout expires. Combine with `Restart=always` for auto-recovery.

**Cron-based watchdog** (alternative if not using systemd):

```bash
# Add to crontab — checks every 5 minutes
*/5 * * * * [ $(( $(date +%s) - $(stat -c %Y /tmp/podders-heartbeat 2>/dev/null || echo 0) )) -gt 300 ] && systemctl restart podders
```

## Reverse Proxy Notes

Fastify is configured with `trustProxy: 1` (not `true`) when `PUBLIC_URL` is
set. This trusts exactly one hop (the Caddy/nginx reverse proxy) and prevents
IP spoofing via chained `X-Forwarded-For` headers. When `PUBLIC_URL` is unset,
`trustProxy` is `false`.

## TLS / HTTPS

**Caddy** as reverse proxy — automatic HTTPS with Let's Encrypt, ~10MB RAM.

```
# /etc/caddy/Caddyfile
podders.yourdomain.com {
    reverse_proxy localhost:3000
}
```

Alternative: **Cloudflare Tunnel** (free) if you don't want to open ports 80/443.

## Monitoring

### Logs

Pino JSON logs go to stdout. Options:
- **Minimum (pm2)**: `pm2 logs podders` — pm2 manages log files in `~/.pm2/logs/`, add `pm2-logrotate` module
- **Minimum (systemd)**: `journalctl -u podders -f` — systemd journal handles rotation
- **Better**: Better Stack (Logtail) free tier (1GB/mo) — pipe stdout via `pino-transport`
- **Full**: Loki + Grafana on same VPS (~200MB RAM overhead)

### Uptime

External health check on `/api/v1/status` every 60s. Options:
- **Uptime Kuma** self-hosted on same VPS (10MB RAM)
- **Better Stack** free tier (10 monitors)
- Alert to Discord webhook — already have delivery infrastructure

## Deploys

### Procedure

```bash
# Pull latest code
cd /opt/podders && git pull

# Install deps + build (backend tsc + dashboard vite in one command)
npm install && npm run build

# Restart (pm2)
pm2 restart podders

# Or restart (systemd)
sudo systemctl restart podders
```

### Message Loss During Restart

Discord polling pauses during restart (~5-10s). On the next successful poll, the process resumes from the stored `last_id`, so short restarts usually catch up cleanly. The main remaining risk is a very busy channel exceeding the 250-message poll cap while the process is down.

Crash recovery handles in-flight LLM work: orphaned `processing` items reset to `ready` on startup.

## Backup

### Daily Backup

Automated inside `onDaily()` — runs after daily synthesis and delivery
complete. Writes compressed dumps to `DATA_DIR` (default `./data`). Retains 7
daily backups; older files are deleted automatically.

The backup code parses `DATABASE_URL` to extract host/port/username/dbname and
passes `PGPASSWORD` via the child process environment — credentials never
appear as CLI arguments. Example invocation (internal):

```
PGPASSWORD=xxx pg_dump --host ... --port ... --username ... --dbname ... --no-password | gzip > data/podders_YYYYMMDD.sql.gz
```

Ensure the `DATA_DIR` directory exists and is writable:

```bash
mkdir -p ./data
```

### Verification

After backup, verify the dump is valid and contains data:

```bash
gunzip -t /var/backups/podders/podders_YYYYMMDD.sql.gz
if [ $? -ne 0 ]; then
  echo "Backup verification failed"
  exit 1
fi
```

### Restore

```bash
pm2 stop podders  # or: sudo systemctl stop podders
gunzip < /var/backups/podders/podders_YYYYMMDD.sql.gz | psql $DATABASE_URL
pm2 start podders  # or: sudo systemctl start podders
```

### Restore Testing

Test restore monthly on a separate database to verify backups are usable:

```bash
createdb podders_restore_test
gunzip < /var/backups/podders/podders_YYYYMMDD.sql.gz | psql podders_restore_test
# Verify data, then clean up:
dropdb podders_restore_test
```

## Discord OAuth2 (Dashboard Auth)

Dashboard login uses Discord OAuth2. This is separate from the bot — `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` are for user login, `DISCORD_BOT_TOKEN` / `DISCORD_TOKENS` are for scraping.

### Environment Variables

| Var | Required | Notes |
|-----|----------|-------|
| `DISCORD_CLIENT_ID` | Yes (for dashboard auth) | Discord OAuth2 application client ID |
| `DISCORD_CLIENT_SECRET` | Yes (for dashboard auth) | Discord OAuth2 application client secret |
| `ADMIN_USER_IDS` | Yes | Comma-separated Discord user IDs with admin access |
| `SESSION_SECRET` | No | 32-byte hex for signing session cookies. Auto-generated on first run, stored in `app_config`. Prominent `console.error` warning at startup if not set in `.env` |

### Discord Developer Portal Setup

1. Create a new application at https://discord.com/developers/applications (or reuse existing).
2. Under **OAuth2**, add a redirect URI: `{PUBLIC_URL}/api/v1/auth/discord/callback`.
3. Copy the Client ID and Client Secret into `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET`.
4. `PUBLIC_URL` must be set when using Discord auth — the server needs it to build the callback URL. A `console.error` warning fires at startup if Discord OAuth is configured without `PUBLIC_URL`.

## Secret Rotation

| Secret | Procedure | Downtime |
|--------|-----------|----------|
| `API_KEY` | `POST /api/v1/auth/rotate` | None (live) |
| `DISCORD_TOKENS` | Update `.env`, restart | ~5-10s |
| `ANTHROPIC_API_KEY` | Update `.env`, restart | ~5-10s |
| `GEMINI_API_KEY` | Update `.env`, restart | ~5-10s |
| `TWITTERAPI_KEY` | Update `.env`, restart | ~5-10s |
| `SESSION_SECRET` | Update `.env` or `app_config`, restart | ~5-10s |
| `DISCORD_CLIENT_SECRET` | Rotate in Discord Developer Portal, update `.env`, restart | ~5-10s |

### Session & OAuth Secret Details

- **`SESSION_SECRET` rotation**: update the env var (or the value in `app_config`), restart the server. All existing sessions are invalidated — cookies signed with the old secret can't be verified. Users must re-login via Discord OAuth.
- **`DISCORD_CLIENT_SECRET` rotation**: rotate the secret in the Discord Developer Portal first, then update the env var and restart. In-flight OAuth flows will fail; users retry and it works.

## Startup Warnings

`SESSION_SECRET` and `API_KEY` both generate prominent `console.error` warnings at startup if not explicitly set in `.env`. The server still runs (auto-generating values), but the warnings ensure operators notice before production deployment.

## Static Asset Serving

Fastify serves the Vite-built dashboard as static files. Cache-Control headers are set per path:

- `/assets/*` (hashed filenames): `immutable, max-age=31536000` -- browser caches indefinitely, hash busting on redeploy
- HTML files: `no-cache` -- always revalidated so users get the latest SPA shell

## Postgres Operational Details

### Migrations

Migration 8 adds `'failed'` to the `items.status` CHECK constraint, allowing items that permanently fail processing to be marked without blocking the pipeline.

### Advisory Lock on Migrations

`runMigrations()` acquires `pg_advisory_lock(42424242)` before checking
`schema_version`. This prevents two instances from running migrations
concurrently during rolling deploys or accidental double-starts. The lock is
released after migrations complete (or when the connection is returned to the
pool on error).

### Statement Timeout

Every new connection from the pool sets `statement_timeout = 30000` (30s) via
`pool.on('connect')`. This prevents runaway queries from holding connections
indefinitely. Long-running operations (like `pg_dump` for backups) use their
own process and are not subject to this timeout.

## Postgres Storage

With 30-day item retention, DB plateaus after ~30 days:

| Table | Rows (30-day) | Size |
|-------|--------------|------|
| items | ~150K | ~150MB |
| summaries (90d) | ~1,000 | ~10MB |
| entities | ~2-5K | ~5MB |
| reports | grows forever | ~1MB/year |
| indexes | — | ~30MB |
| **Total** | | **~200MB stable** |

### Maintenance

- **Weekly VACUUM ANALYZE**: reclaim space and update planner statistics after bulk retention deletes
- **REINDEX CONCURRENTLY** if index bloat exceeds 30% (rare with retention)
- DB size is stable — retention caps growth
