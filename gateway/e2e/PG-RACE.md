# Postgres monthly cap-race gate (manual, pre-hosting)

This is a **manual pre-hosting gate**, not a CI job. There is no workflow change for it.

It checks that concurrent reservations on a **real, local Postgres** cannot spend past the shared monthly token cap (plans A 5M / B 20M; this fixture uses a 10,000-token cap). Do not point `OMK_GATEWAY_DATABASE_URL` at a hosted or shared database. Use a throwaway local server bound to `127.0.0.1` only. The password below is a placeholder, not a secret.

PGlite stays the default for everyday tests. This gate is required before hosting.

## Prerequisites

- Docker, with permission to run containers.
- Node 22 on `PATH` (`node -v` should print `v22.x`). One usual path:

  ```bash
  export PATH=$HOME/.nvm/versions/node/v22.23.4/bin:$PATH
  node -v
  ```

- Install gateway deps from the repo root:

  ```bash
  cd gateway && npm ci
  ```

The commands below assume the current directory is `gateway/`.

## Start a local Postgres 17

The publish address is `127.0.0.1` only (not `0.0.0.0`). `localonly` is a placeholder password, safe to type as-is.

```bash
docker run -d --name omk-gateway-pg --publish 127.0.0.1:5432:5432 \
  -e POSTGRES_USER=omk_gw -e POSTGRES_PASSWORD=localonly -e POSTGRES_DB=omk_gateway \
  postgres:17
```

Wait until the server accepts connections:

```bash
until docker exec omk-gateway-pg pg_isready -U omk_gw -d omk_gateway; do sleep 1; done
```

`pg_isready` prints `/var/run/postgresql:5432 - accepting connections` and the loop exits when the exit code is 0. The first few tries may print `/var/run/postgresql:5432 - no response` or a starting-up message; that is expected.

## Env and commands

```bash
export OMK_GATEWAY_DATABASE_URL='postgres://omk_gw:localonly@127.0.0.1:5432/omk_gateway'
```

Race test only:

```bash
npx vitest run test/pg-race.test.ts
```

Full gateway suite (PGlite tests plus the race test):

```bash
npm test
```

PGlite-only (race test skipped — do this with the URL unset):

```bash
unset OMK_GATEWAY_DATABASE_URL
npm test
```

## Expected numbers

The race fixture is fixed: cap **10,000** tokens, **50** concurrent `OMK/coder` requests, each reserving **501** tokens (`max_tokens` 500 plus 1 for the 2-character prompt `"hi"` at 4 chars/token). 501 is greater than `R/N*2` = 400, so a naive check-then-insert overspends. The mock upstream is held behind a gate until every request has reserved or been rejected.

A passing run on this head must show:

| Check | Expected |
|---|---|
| Successful requests | **19** × HTTP 200 (`floor(10000/501)`) |
| Rejected requests | **31** × HTTP 429, error code `request_limit_exceeded` (the existing cap error while in-flight reservations block the rest; `quota_exceeded` is also accepted by the test but is not the code this fixture produces) |
| Tokens held in `reservations` before the gate opens | **9,519** (19 × 501) and **≤ 10,000** |
| After settle | `usage_events` sum = `usage_monthly.tokens` = **285** (19 × 15 charged tokens) |
| Open reservations after settle | **0** |
| Full suite with the URL set | **152 passed** (11 files) |
| Full suite with the URL unset (PGlite) | **151 passed, 1 skipped** (the race test) |

The test asserts these values; a passing `vitest` run is enough. The assertions fail if reserved tokens exceed the cap or the counts do not match.

## Reproducing the "before" FAIL (not part of the gate)

The unlocked check-and-insert from `c82c5bdb10` over-reserved under concurrent Postgres connections. Reproducing that failure is **evidence only**, not a step of this gate. It needs a **temporary patch**: the race test and the Postgres driver did not exist at `c82c5bdb10`, so that commit cannot be tested as-is.

On this branch, replace only `tryReserve` in `src/store.ts` with the `c82c5bdb10` body (single-statement `INSERT ... SELECT`, no transaction, no row lock). Leave the rest of the file alone, including the `import type { Db, Queryable }` and callers. The old signature takes `Queryable`; that still compiles.

```ts
export async function tryReserve(db: Queryable, o: { userId: string; month: string; tokens: number; cap: number; now: Date }): Promise<string | null> {
	const id = newId("rsv");
	const r = await db.query(
		`INSERT INTO reservations(id,user_id,month,tokens,created_at)
		 SELECT $1::text,$2::text,$3::text,$4::bigint,$5::timestamptz
		 WHERE $6::bigint
		   - COALESCE((SELECT tokens FROM usage_monthly WHERE user_id=$2::text AND month=$3::text),0)
		   - COALESCE((SELECT SUM(tokens) FROM reservations WHERE user_id=$2::text AND month=$3::text),0) >= $4::bigint
		 RETURNING id`,
		[id, o.userId, o.month, o.tokens, o.now.toISOString(), o.cap],
	);
	return r.rows[0] ? id : null;
}
```

With `OMK_GATEWAY_DATABASE_URL` still set, run `npx vitest run test/pg-race.test.ts`. The test FAILs because reserved tokens exceed the cap. How far it overshoots is racy (it depends on connection scheduling). Two observed runs on this fixture:

- `AssertionError: expected 10020 to be less than or equal to 10000` — **20 × 501 = 10,020** (the original evidence run)
- `AssertionError: expected 11022 to be less than or equal to 10000` — **22 × 501 = 11,022** (a later reproduction)

A reproduction is successful if reserved is **greater than 10,000**. The exact surplus is not a gate number. Restore the file before committing or re-running the gate:

```bash
git checkout -- src/store.ts
```

A passing gate on the locked `tryReserve` does **not** require repeating this patch.

## Pass / fail

**PASS** when all of the following hold:

- `npx vitest run test/pg-race.test.ts` with the URL set exits 0 and matches the table above.
- `npm test` with the URL set is **152 passed**.
- `npm test` with the URL unset is **151 passed, 1 skipped**.

**FAIL** when reserved tokens exceed the cap, the 200/429 counts are wrong, `usage_events` and `usage_monthly` disagree, reservations are left open, or any of those commands exits non-zero.

Do not merge or host on a FAIL. Do not add this job to CI (the workflow file still needs a separate OK).

## Cleanup

```bash
unset OMK_GATEWAY_DATABASE_URL
docker rm -f omk-gateway-pg
```

That stops and removes the throwaway container. It does not remove the `postgres:17` image.
