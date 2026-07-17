# B2a — `match:active` index store

**Depends on:** B0. **Blast radius:** additive, LOW.
**Commit:** `feat(distributed): B2a match-active index store`.

## Why

Recovery (B3b) needs to enumerate in-flight matches. Today only per-key `match:state:<id>`
exists — there is no index. Add one, mirroring `game-loop.countdown-store.ts`'s
`room:countdowns` SET pattern.

## New file — `apps/api/src/modules/match/match-ownership.store.ts`

Small pure helpers over `RedisService` (pass it in, or export functions taking a client).
Keys per `01-REFERENCE.md` schema. Provide:

```ts
// Export the key builders so MatchOwnershipService (B2b) and ClusterService
// import the exact contract strings instead of re-deriving them.
export const ACTIVE_SET = "match:active";
export const fenceKey = (id: string) => `match:fence:${id}`;
export const ownerKey = (id: string) => `match:owner:${id}`;

addActiveMatch(redis, matchId): Promise<void>       // SADD match:active
removeActiveMatch(redis, matchId): Promise<void>     // SREM match:active
listActiveMatchIds(redis): Promise<string[]>         // SMEMBERS match:active
nextFence(redis, matchId): Promise<number>           // INCR match:fence:<id>
readOwner(redis, matchId): Promise<string | null>    // GET match:owner:<id>
```

Keep the key builders exported so `MatchOwnershipService` (B2b) and `ClusterService`
reuse the exact same strings.

## Tests — `match-ownership.store.spec.ts`

Mock `RedisService` (sadd/srem/smembers/incr/get) and assert each helper calls the right
command with the right key. Round-trip add→list→remove with `ioredis-mock` if convenient.

## Verify / done

- Focused spec green; build + lint clean. No existing callers, so full suite unaffected.
