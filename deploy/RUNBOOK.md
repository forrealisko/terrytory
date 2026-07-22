# Terrytory → Hetzner migration runbook

Evening playbook. Copy-paste top to bottom. Keep Vercel live until the last step
so there's zero downtime and instant rollback.

**Server:** Hetzner CX23 (€5.99/mo), image **Ubuntu 24.04**.
**Key fact:** on a writable disk the admin saves directly — no GITHUB_TOKEN, no
publish delay, no scrape-and-commit dance. That whole class of workaround dies.

---

## 0. Before touching the server (do at home)
- Create the CX23 with an **SSH key** (Hetzner console → add your key), Ubuntu 24.04.
- Have these 6 env values ready (they're in `website/.env.local` now):
  `OPENROUTER_API_KEY  FAL_KEY  SESSION_SECRET  ADMIN_USER  ADMIN_PASSWORD  SCRAPER_BASE_PATH`

## 1. First SSH + base setup
```bash
ssh root@<SERVER_IP>
apt update && apt upgrade -y
# Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs git
# Playwright/Chromium system libs (the classic gotcha — do it now)
npx --yes playwright@latest install-deps chromium
node -v   # expect v22.x
```

## 2. Get the code
```bash
cd /opt
git clone https://github.com/forrealisko/terrytory.git
cd terrytory
```

## 3. Env files
```bash
# website env — paste the 6 values
nano website/.env.local
# scraper env — proxy vars live here (or set PROXY_ENABLED=false to skip BrightData)
nano system/.env
```

## 4. Install + build
```bash
cd /opt/terrytory/website && npm ci && npm run build
cd /opt/terrytory/system/scraper/engine && npm ci
cd /opt/terrytory/system/content && npm ci
npx --yes playwright install chromium   # the browser binary itself
```

## 5. Run the web server under systemd
`/etc/systemd/system/terrytory-web.service`:
```ini
[Unit]
Description=Terrytory web (Next.js)
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/terrytory/website
ExecStart=/usr/bin/npm run start
Environment=NODE_ENV=production
Environment=PORT=3000
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```
```bash
systemctl daemon-reload
systemctl enable --now terrytory-web
systemctl status terrytory-web        # should be active (running)
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000   # expect 200
```

## 6. Caddy = reverse proxy + automatic HTTPS
```bash
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy
```
`/etc/caddy/Caddyfile` (Caddy fetches TLS certs automatically):
```
terrytory.xyz, www.terrytory.xyz, ai.terrytory.xyz, tech.terrytory.xyz {
	reverse_proxy localhost:3000
	encode gzip
}
```
```bash
systemctl reload caddy
```
> Certs only issue once DNS points here (step 8). Test on the raw IP first if impatient.

## 7. Cron: scraper + scheduled publish (replaces the GitHub Actions)
`crontab -e`:
```cron
# Daily scrape 06:00 UTC (respects vacation mode in runtime-settings.json)
0 6 * * * cd /opt/terrytory && /usr/bin/node system/scrape-all.mjs >> /var/log/terrytory-scrape.log 2>&1
# Promote due scheduled drafts every 15 min
*/15 * * * * cd /opt/terrytory && /usr/bin/node system/content/publish-due.mjs >> /var/log/terrytory-publish.log 2>&1
```
> On the box, publishing writes straight to disk — no git commit needed for the
> site to update. Keep it a plain `node`, drop the commit/push steps.

## 8. Flip DNS (the point of no return — do last, after verifying on the IP)
Namecheap → Advanced DNS. Point everything at the server:
- `A` record, host `@`   → `<SERVER_IP>`
- `A` record, host `www` → `<SERVER_IP>`
- `A` record, host `ai`  → `<SERVER_IP>`
- `A` record, host `tech`→ `<SERVER_IP>`
- Remove the old Vercel records.

Wait ~10–30 min. Then Caddy auto-issues HTTPS. Check:
```bash
curl -sI https://www.terrytory.xyz | head -1
curl -sI https://ai.terrytory.xyz | head -1
```

## 9. Deploys from now on
`deploy/deploy.sh` on the box (or just run these):
```bash
cd /opt/terrytory && git pull
cd website && npm ci && npm run build
systemctl restart terrytory-web
```

---

## Rollback
DNS still on Vercel until step 8, so before that: nothing to undo, just
`systemctl stop terrytory-web`. After step 8: point the Namecheap A records back
to Vercel's values.

## Once stable — turn OFF the GitHub Actions
`.github/workflows/scrape.yml` and `publish-scheduled.yml` now duplicate the box
cron. Disable them (or delete) so they stop running and committing.

## Things that get simpler after this
- `content-writer.ts` GitHub-API path becomes dead (writable disk) — admin saves direct.
- No `[skip ci]`, no `GITHUB_TOKEN`, no 1-min publish lag.
- Vacation mode still works (cron reads the flag before spending).
