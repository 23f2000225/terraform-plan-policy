# terraform-plan-policy

A deterministic policy-as-code check for a single **normalized** Terraform
resource change. No LLM, no fuzzy matching — every decision is a type check,
a set-membership check, a regex against `providerVersion`, or an exact
label/secret-format comparison.

## Endpoint

`POST /terraform/plan`, always responds `200 OK` with:
```json
{ "decision": "approve | reject", "reason": "..." }
```

## Rule order (first failing rule wins)

1. **INVALID_PLAN** — `environment` is a string; `state` is an object with
   `backend: string` and `locked: boolean`; `providerVersion` is a string;
   `destroyApproved` is a boolean; `resource` is an object with
   `address: string`, `type: string`, `action` ∈ {create, update, delete},
   `labels` an object of string→string, `secret` is `null` or a string,
   `forceDestroy: boolean`.
2. **ENVIRONMENT_MISMATCH** — `environment` must equal `prod-mnu3ks` exactly.
3. **STATE_UNSAFE** — `state.backend` ∈ {gcs, s3, azurerm, remote} **and**
   `state.locked === true`.
4. **UNPINNED_PROVIDER** — `providerVersion` must be an exact pin
   (`6.2.1` or `= 6.2.1`) or a pessimistic pin (`~> 6.0`, `~> 6.0.1`).
   `>=`, `*`, `latest`, or anything else is rejected.
5. **MISSING_LABELS** — `resource.labels` must contain all three of
   `owner=student-3e7hk`, `environment=production`, `cost_center=cc-1wbe`
   with those exact values (extra labels are fine).
6. **PLAINTEXT_SECRET** — `resource.secret` must be `null` or a non-empty
   `secret://...` reference.
7. **DELETE_NOT_APPROVED** — deleting a `storage_bucket`, `sql_database`, or
   `persistent_disk` requires `destroyApproved === true`.
8. **FORCE_DESTROY** — a `storage_bucket` resource may never have
   `forceDestroy: true`.

If nothing above fires: `{"decision":"approve","reason":"APPROVE"}`.

`tests.sh` exercises 27 cases — every rule's pass and fail path, ordering
edge cases (e.g. an approved delete that still trips `FORCE_DESTROY`), and
a delete of a non-guarded resource type that does *not* need approval.

## Run locally

```bash
npm install
npm start
# terraform-policy listening on :8788
curl -s -X POST http://localhost:8788/terraform/plan \
  -H 'Content-Type: application/json' \
  -d '{"environment":"prod-mnu3ks","state":{"backend":"gcs","locked":true},"providerVersion":"~> 6.0","destroyApproved":false,"resource":{"address":"google_storage_bucket.data","type":"storage_bucket","action":"create","labels":{"owner":"student-3e7hk","environment":"production","cost_center":"cc-1wbe"},"secret":null,"forceDestroy":false}}'
# {"decision":"approve","reason":"APPROVE"}
```

---

## Getting a public base URL for the grader (step by step, Render.com)

The grader needs a plain `https://...` base URL (no path, no query string,
no credentials) that it can `POST /terraform/plan` to directly. Render's
free tier gives you exactly that with no credit card. Total time: ~5 minutes.

### 1. Put the code in a GitHub repo
1. Go to https://github.com/new.
2. Name it something like `terraform-plan-policy`. Keep it **Public** (Render
   free tier can also use private repos once you connect your GitHub
   account, but public is simplest). Click **Create repository**.
3. On your own machine (or upload via GitHub's web UI "Add file → Upload
   files"), add these four files exactly as provided:
   - `server.js`
   - `package.json`
   - `Dockerfile` (optional — Render can also build from Node directly)
   - `README.md`
4. Commit and push to the `main` branch. If using git locally:
   ```bash
   git init
   git add server.js package.json Dockerfile README.md
   git commit -m "terraform plan policy service"
   git branch -M main
   git remote add origin https://github.com/<your-username>/terraform-plan-policy.git
   git push -u origin main
   ```

### 2. Create the Render account and service
1. Go to https://render.com and sign up (GitHub OAuth sign-in is fastest —
   it also grants repo access automatically).
2. From the Render Dashboard, click **New +** (top right) → **Web Service**.
3. Under "Build and deploy from a Git repository," find and select
   `terraform-plan-policy`, then click **Connect**. If it's not listed,
   click **Configure account** to grant Render access to that repo.

### 3. Configure the service
Fill in the form exactly like this:
- **Name**: `terraform-plan-policy` (this becomes part of your URL).
- **Region**: pick the one closest to you (doesn't affect grading).
- **Branch**: `main`.
- **Root Directory**: leave blank (files are at repo root).
- **Runtime**: `Node`.
- **Build Command**: `npm install`
- **Start Command**: `npm start`
- **Instance Type**: `Free`.

Leave everything else default. Click **Deploy Web Service** at the bottom.

### 4. Wait for the build
Render streams build logs on screen. You're looking for a line like:
```
==> Your service is live 🎉
terraform-policy listening on :10000
```
(Render sets `PORT` itself — the server already reads `process.env.PORT`,
so no changes needed.) This takes 1–3 minutes on the free tier.

### 5. Get your base URL
At the top of the service page Render shows a URL like:
```
https://terraform-plan-policy.onrender.com
```
That whole string — nothing appended — is what you submit to the grader as
your **base URL**. The grader will itself call
`https://terraform-plan-policy.onrender.com/terraform/plan`.

### 6. Verify it before submitting
From your own terminal (or Render's own shell), confirm the live service
answers correctly:
```bash
curl -s -X POST https://terraform-plan-policy.onrender.com/terraform/plan \
  -H 'Content-Type: application/json' \
  -d '{"environment":"prod-mnu3ks","state":{"backend":"gcs","locked":true},"providerVersion":"~> 6.0","destroyApproved":false,"resource":{"address":"google_storage_bucket.data","type":"storage_bucket","action":"create","labels":{"owner":"student-3e7hk","environment":"production","cost_center":"cc-1wbe"},"secret":null,"forceDestroy":false}}'
```
Expect:
```json
{"decision":"approve","reason":"APPROVE"}
```

### Notes / gotchas
- **Free-tier cold start**: Render's free instances sleep after ~15 minutes
  idle and take a few seconds to wake on the next request. The grader's
  10-second timeout should comfortably cover a cold start for this tiny app,
  but if you want to be extra safe, open the URL in a browser (or send one
  curl request) right before the grader runs, to warm it up.
- **No trailing slash / no query string** in the URL you submit — just the
  bare origin, e.g. `https://terraform-plan-policy.onrender.com`.
- **Don't put the endpoint path in the submitted URL** — the grader appends
  `/terraform/plan` itself.
- If you'd rather not use GitHub, Render also supports deploying directly
  from a public Git URL or via their CLI; Railway.app and Fly.io are
  equally viable alternatives and both auto-detect the `Dockerfile` /
  `package.json` in this repo the same way.

### Alternative: Fly.io (if you prefer CLI over GitHub)
```bash
# from inside this project folder
fly launch --now    # auto-detects the Dockerfile, asks a few questions
# fly assigns a URL like https://terraform-plan-policy.fly.dev
```

### Alternative: plain Docker on any VM with a public IP
```bash
docker build -t terraform-plan-policy .
docker run -d -p 443:8788 -e PORT=8788 terraform-plan-policy
# then put a reverse proxy / TLS cert (e.g. Caddy) in front for https://
```
