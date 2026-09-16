# Update policy runbook

How to stage, pause, force and roll back Linty updates on installed copies. The app-side rules are in `src-tauri/src/policy.rs` and summarised in `CLAUDE.md`. This page is for the person operating releases.

## How it fits together

- CI publishes every merge to `main` as a GitHub release. That release does not reach anyone by itself once a policy exists.
- `updates.linty.ai` is a Cloudflare Worker (`infra/updates`). It serves the signed policy and the target release's `latest.json`.
- The app fetches the policy before every update check. It trusts the policy only if the signature verifies with the policy key built into the app.
- `scripts/policy/publish.mjs` builds, signs, verifies and uploads a policy.
- If no policy has ever been published, the worker answers 404 and the app falls back to GitHub's latest release, as older builds do.
- Builds released before the policy engine shipped (0.0.38 and earlier, at least) ignore all of this. They only ever follow GitHub's latest release, so a pre-release flag on a bad release is the only lever for them.

The worker stores one count per request: route, channel, platform and version. It stores no IP address, user agent or identifier, and Workers Logs are off.

## One-time setup

1. **Keys.** The maintainer holds the policy and root private keys outside the repository and CI. Back both up in two places before the first build that contains `keys.rs` ships. They can never be replaced on installed copies.
2. **Signing environment.** `publish.mjs` reads `LINTY_POLICY_KEY_PATH` and `LINTY_POLICY_KEY_PASSWORD`. Run `yarn install` once so `node_modules/.bin/tauri` exists.
3. **Cloudflare.** From `infra/updates`:

   ```bash
   npx wrangler@4.132.0 login
   npx wrangler@4.132.0 kv namespace create POLICY    # paste the id into wrangler.toml and commit it
   npx wrangler@4.132.0 deploy                        # also creates the updates.linty.ai DNS record
   ```

   Analytics Engine must be enabled on the account (Workers → Analytics Engine) before the first deploy.
4. **Check the host.** A new namespace has no policy, so this should answer 204:

   ```bash
   curl -i https://updates.linty.ai/v1/policy/stable/darwin-aarch64/0.0.0
   ```

5. **First policy.** Publish the current release at full rollout, so nothing changes for anyone:

   ```bash
   node scripts/policy/publish.mjs --action prompt --version <current release> --percent 100
   ```

## Everyday commands

| Goal | Command |
|---|---|
| See what is published | `node scripts/policy/publish.mjs --show` |
| Check a change without uploading | add `--dry-run` |
| Start a staged rollout | `--action prompt --version X --percent 10` |
| Widen it | `--action prompt --version X --percent 50`, then `100` |
| Re-sign before expiry | `--refresh` |

`--version` defaults to the published target, and `--percent` defaults to 10 for `prompt` and 100 otherwise. Policies expire after 14 days (`--days` changes that). Re-sign weekly with `--refresh`. Once a policy expires, copies stay at its target until a new one arrives: a lapse freezes updates, it never releases them.

Blocked versions, the minimum version and the remote config carry over into every new policy until you change them. `--unblock`, `--clear-min`, `--cloud-stt on` and `--clear-banner` change them. The message never carries over.

## Releasing a new version

1. Merge to `main` and wait for the "Build macOS DMG" workflow to publish the release.
2. `node scripts/policy/publish.mjs --action prompt --version X --percent 10`.
3. Wait 24 hours. There is no telemetry, so the signals are the support inbox and the request counts.
4. `--percent 50`, wait again, then `--percent 100`.

Request counts by version for the last day, from the Analytics Engine SQL API (needs an API token with Account Analytics read):

```bash
curl -s "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/analytics_engine/sql" \
  -H "Authorization: Bearer $CF_ANALYTICS_TOKEN" \
  --data "SELECT blob4 AS version, SUM(_sample_interval) AS checks
          FROM linty_update_checks
          WHERE blob1 = 'policy' AND timestamp > NOW() - INTERVAL '1' DAY
          GROUP BY version ORDER BY checks DESC"
```

Version `0.0.0` is `publish.mjs` itself.

## Incidents

Run `--show` first. Every command below keeps whatever else is published.

| Situation | Command |
|---|---|
| Stop a rollout | `--action pause` |
| Move everyone off a bad build | `--action rollback --version <good> --block <bad> --message "<what happened>"` |
| Require a fix | `--action force --version <fixed> --block <bad> --message "<why>"` |
| Require at least a version | `--action <current action> --min <version>` |
| Turn off cloud transcription | `--action <current action> --cloud-stt off --banner "<what users see>"` |

For a bad build, also:

- Mark the bad GitHub release as a pre-release (`gh release edit v<bad> --prerelease`). Copies that never received a policy follow GitHub's latest release.
- Post on the status page.
- Watch the counts for the bad version fall. Copies check at launch, every 15 minutes and when the Mac wakes, so running copies move within the hour. A required update installs after 30 seconds without dictation. Copies that stay closed move when next opened.

A rollback runs an older build against data files a newer build wrote. Before rolling back past a release that changed a file format, route copies through a release that can read both.

## Rehearsal

Rehearse before any external user has a build, on a Mac with a Finder-installed copy:

1. Publish release N at 100 %. Install it.
2. Merge a harmless change, wait for release N+1 and publish it at 100 %. Confirm the app offers it and installs it.
3. `--action rollback --version N --block N+1`. Confirm the app goes back to N.
4. Confirm Microphone and Accessibility still work without a new prompt, history and settings load, and `~/Library/Logs/ai.linty.desktop/linty.log` shows the policy lines.
5. `--action prompt --version N --percent 100 --unblock N+1` to finish in a clean state, or leave N+1 blocked.
