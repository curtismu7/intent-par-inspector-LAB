# The forbidden-string gate

The kit is meant to be shared, so no identifier from another project's tenant may appear in a tracked file. `npm run check:forbidden`
(`scripts/check-forbidden-strings.mjs`) fails when a tracked file contains

- any line of the **forbidden-strings list** (matched case-insensitively; a hit is reported as `file:line entry #N`, never as the value),
- a UUID in docs or examples that `scripts/forbidden-allowlist.json` does not list, or
- a private Ping hostname that the allowlist does not list.

The list itself holds the very identifiers it guards against, so it is **never committed**.

## Where CI gets the list

The `forbidden-strings` job in `.github/workflows/ci.yml` takes the list from the `FORBIDDEN_STRINGS` repository secret (one string per line)
and writes it to a temporary file for the run. Without the secret the job fails under `CI=true`: the gate cannot be skipped. CI runs on
GitHub-hosted runners, so there is no runner-side list.

To keep a local copy for your own runs, put one string per line in `~/.config/demo-kit/forbidden-strings.txt` (mode 600, outside this repository,
never committed). Settings that hold only identifiers (names ending in `ENVIRONMENT_ID`, `ENV_ID`, `CLIENT_ID` or `APP_ID`) are the usual
source; client IDs that are not in an `.env` can be appended by hand.

## Run it locally with the real list

```sh
FORBIDDEN_STRINGS_FILE=~/.config/demo-kit/forbidden-strings.txt npm run check:forbidden
```

Without `FORBIDDEN_STRINGS_FILE` the exact-string check is skipped locally (with a notice) and the host and UUID checks still run.
