# Deploy: Roast My Startup booth

Runbook for putting the booth on a Google Compute Engine VM with HTTPS, for
MongoDB .local NYC (Sep 30, Pier 36). One VM, one Node process, Caddy in front
for TLS. The backup laptop keeps running on `localhost` as the fallback.

## How it fits together

- **Caddy** listens on 443/80, terminates TLS with a real Let's Encrypt cert for
  a `sslip.io` hostname, and reverse-proxies everything to the Node app on
  `localhost:3001`. It upgrades `/ws` to a WebSocket automatically.
- **Node app** (`npm start` → `tsx server/index.ts`) serves the built bundle,
  the API, and the single stateful WebSocket. It reads config from `.env`.
- **sslip.io** gives us a hostname that resolves to the VM's IP with no DNS
  setup: `34.86.12.34.sslip.io` resolves to `34.86.12.34`. That is enough for
  Let's Encrypt to issue a cert.
- **GCS** stores finished videos; founders get 7-day V4 signed links by email.
  On the VM the attached service account IS the identity, so there is no key
  file and no impersonation.

`/station` needs a secure context (HTTPS) for camera and mic. That is the whole
reason Caddy is here. The backup laptop is exempt because it runs on
`localhost`.

## Before you start

Do these first. Several are one-time and easy to forget under booth pressure.

1. **Rotate the two secrets that leaked into chat.** Generate a new ElevenLabs
   API key and a new Atlas password. Put the new values in the VM `.env` (below).
   Do not reuse the old ones.
2. **Grant the storage SA the right to sign as itself.** V4 signing on the VM
   uses the IAM `signBlob` API, which needs Token Creator on the SA itself:
   ```
   gcloud iam service-accounts add-iam-policy-binding \
     roast-booth-storage@roast-my-startup-509518.iam.gserviceaccount.com \
     --member="serviceAccount:roast-booth-storage@roast-my-startup-509518.iam.gserviceaccount.com" \
     --role="roles/iam.serviceAccountTokenCreator" \
     --project=roast-my-startup-509518
   ```
3. **Confirm the storage APIs are on** (already done on this project, verify):
   ```
   gcloud services list --enabled --project=roast-my-startup-509518 \
     | grep -E "iamcredentials|storage"
   ```
4. Have the new Atlas password ready for the Network Access step below.

## 1. Create the VM

Region `us-east4` (matches the bucket and NYC). Attach the storage SA so the app
authenticates with no key file.

```
gcloud compute instances create roast-booth \
  --project=roast-my-startup-509518 \
  --zone=us-east4-a \
  --machine-type=e2-standard-4 \
  --image-family=debian-12 --image-project=debian-cloud \
  --boot-disk-size=30GB \
  --service-account=roast-booth-storage@roast-my-startup-509518.iam.gserviceaccount.com \
  --scopes=cloud-platform \
  --tags=http-server,https-server
```

`e2-standard-4` gives ffmpeg room during the Done→next handoff. `--scopes=cloud-platform`
lets the attached SA reach GCS and IAM. `--tags` line them up with the firewall
rules below.

Reserve the IP so the `sslip.io` name and the TLS cert stay valid across reboots:

```
gcloud compute instances describe roast-booth --zone=us-east4-a \
  --format='get(networkInterfaces[0].accessConfigs[0].natIP)'
# take that IP:
gcloud compute addresses create roast-booth-ip --region=us-east4 \
  --addresses=<THAT_IP>
```

Open 80 and 443 only. Port 3001 stays private — Caddy reaches it over localhost:

```
gcloud compute firewall-rules create roast-web \
  --project=roast-my-startup-509518 \
  --allow=tcp:80,tcp:443 \
  --target-tags=http-server,https-server \
  --source-ranges=0.0.0.0/0
```

Note the external IP. With dots swapped in, that is your domain:
`<IP-with-dots>.sslip.io`, e.g. `34.86.12.34.sslip.io`.

## 2. Allowlist the VM in Atlas

Add the VM's external IP to Atlas Network Access (or the write queue will spool
until it can reach the cluster). Atlas UI → Network Access → Add IP Address →
paste the VM IP.

## 3. Install runtime on the VM

SSH in:

```
gcloud compute ssh roast-booth --zone=us-east4-a
```

Node 20, git, and Caddy. No system ffmpeg — the app ships `ffmpeg-static`.

```
# Node 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git

# Caddy (official apt repo)
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy
```

Create the service user and app dir:

```
sudo useradd --system --create-home --shell /usr/sbin/nologin roast
sudo mkdir -p /opt/roast-my-startup
sudo chown roast:roast /opt/roast-my-startup
```

## 4. Get the code onto the VM

The repo is private on `github.com/ali-elhawary`. Use a read-only deploy key.

On the VM, make a key for the `roast` user:

```
sudo -u roast ssh-keygen -t ed25519 -f /home/roast/.ssh/id_ed25519 -N ""
sudo cat /home/roast/.ssh/id_ed25519.pub
```

Add that public key to the repo: GitHub → repo → Settings → Deploy keys → Add
key (read-only). Then clone:

```
sudo -u roast git -C /opt clone git@github.com:ali-elhawary/roast-my-startup.git roast-my-startup
```

Fallback if you skip GitHub: `rsync` from the laptop instead —
`rsync -az --exclude node_modules --exclude dist --exclude .env ./ roast-booth:/tmp/roast/`
then move it into `/opt/roast-my-startup` as the `roast` user.

## 5. Configure `.env` on the VM

`.env` is gitignored, so create it fresh on the VM. Key differences from the
laptop: **no `GCS_IMPERSONATE_SA`** (the attached SA is the identity — setting it
would try to impersonate itself), rotated secrets, and `PUBLIC_BASE_URL` set to
the HTTPS domain.

```
sudo -u roast tee /opt/roast-my-startup/.env >/dev/null <<'EOF'
ELEVENLABS_API_KEY=sk_ROTATED_NEW_KEY
ELEVENLABS_AGENT_ID=agent_2601m2nmv7ske6pt9wbhkh2xazp2
PORT=3001

MONGODB_URI=mongodb+srv://ali:ROTATED_NEW_PASSWORD@roast-my-startup.wxuyde.mongodb.net/?appName=Roast-My-Startup
MONGODB_DB=roast_my_startup

# HTTPS domain, used for email links and the audio-fallback recording base.
PUBLIC_BASE_URL=https://<IP-with-dots>.sslip.io
EMAIL_FROM=Roast My Startup <startups@mongodb.com>

ADMIN_TOKEN=CHOOSE_A_LONG_RANDOM_TOKEN

# GCS: attached SA is the identity. Do NOT set GCS_IMPERSONATE_SA here.
GCS_BUCKET=roast-my-startup-founder-recordings
GCP_PROJECT=roast-my-startup-509518

# Preview email for the first deploy (writes .eml to ./outbox, sends nothing).
# Flip to smtp once IT confirms startups@ auth.
EMAIL_TRANSPORT=preview

VIDEO_ENABLED=true
VITE_VIDEO_ENABLED=true
EOF
```

## 6. Install deps and build

`VITE_VIDEO_ENABLED` must be set at build time (Vite bakes it into the bundle),
so build with the env loaded. Run `npm ci` without `--production` — the build and
`tsx` runtime live in devDependencies.

```
cd /opt/roast-my-startup
sudo -u roast npm ci
sudo -u roast bash -c 'set -a; . ./.env; set +a; npm run build'
sudo -u roast npm run typecheck
```

## 7. Start the app under systemd

```
sudo cp /opt/roast-my-startup/deploy/roast.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now roast
sudo systemctl status roast --no-pager
journalctl -u roast -f     # watch it boot; Ctrl-C to stop tailing
```

You want to see `[server] http://localhost:3001 (prod=true)` and, if Atlas is
reachable, a `[db] hydrated stats` line.

## 8. Turn on TLS with Caddy

Point Caddy at our Caddyfile and feed it the domain and ACME email via a
systemd drop-in (so the committed Caddyfile needs no editing):

```
sudo cp /opt/roast-my-startup/Caddyfile /etc/caddy/Caddyfile

sudo mkdir -p /etc/systemd/system/caddy.service.d
sudo tee /etc/systemd/system/caddy.service.d/roast.conf >/dev/null <<'EOF'
[Service]
Environment=ROAST_DOMAIN=<IP-with-dots>.sslip.io
Environment=ACME_EMAIL=ali.elhawary@gcp.corp.mongodb.com
EOF

sudo systemctl daemon-reload
sudo systemctl restart caddy
journalctl -u caddy -f      # watch it obtain the certificate
```

The first request triggers certificate issuance; give it a few seconds.

## 9. Verify

From your laptop:

```
curl -I https://<IP-with-dots>.sslip.io/            # 200, valid cert
```

Then in a browser:

- `https://<domain>/operator` — controls load, WebSocket connects (no console WS errors).
- `https://<domain>/signin` — sign up a test founder.
- `https://<domain>/station` — the browser prompts for camera and mic (proves the
  secure context works), run one full roast end to end.
- Confirm the run: a `.eml` lands in `/opt/roast-my-startup/outbox` with 7-day
  Watch/Download links, and the objects exist in the bucket:
  ```
  gcloud storage ls gs://roast-my-startup-founder-recordings/
  ```

Optional pre-flight checks (safe, they clean up after themselves):

```
sudo -u roast bash -c 'cd /opt/roast-my-startup && npx tsx scripts/gcscheck.ts'
sudo -u roast bash -c 'cd /opt/roast-my-startup && npx tsx scripts/smoke.ts'
```

## Day-of operations

```
sudo systemctl restart roast     # restart the app
sudo systemctl restart caddy     # restart TLS proxy
journalctl -u roast -f           # live app logs
journalctl -u caddy -f           # live proxy logs
```

Operator URL on the booth machine: `https://<domain>/operator`.

## Updating after a code change

```
cd /opt/roast-my-startup
sudo -u roast git pull
sudo -u roast npm ci
sudo -u roast bash -c 'set -a; . ./.env; set +a; npm run build'
sudo systemctl restart roast
```

## Switching email from preview to live

Once IT confirms auth for `startups@mongodb.com`, edit `.env`:

```
EMAIL_TRANSPORT=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=startups@mongodb.com
SMTP_PASS=<app-password-or-oauth>
EMAIL_REPLY_TO=startups@mongodb.com
```

Then `sudo systemctl restart roast`. `mongodb.com` enforces DMARC `p=reject`, so
mail must go out through Workspace/an IT-authenticated path or it will be
rejected.

## Rollback

The backup laptop runs the same app on `localhost` (no cert needed). If the VM
misbehaves during the event, run the booth off the laptop and debug the VM out
of band. Nothing about the local flow depends on the VM.
