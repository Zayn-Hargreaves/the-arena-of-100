# B5 — Presence leader election

**Depends on:** B0 (lease), B4a (command channel). **Blast radius:** `PresenceService.sweep`
(CRITICAL — B1a). **Commit:** `feat(distributed): B5 presence leader election`.

## Why

`PresenceService.sweep` (`presence.service.ts` ~70-242) iterates `getActiveRooms()` **globally**
and mutates room/match state. On 3 nodes it runs 3× → duplicate `PLAYER_LEFT`, `room.delete`
races (the known Stage-A error), and non-owner mutations of match state machines. Make exactly
one node sweep, and route IN_GAME disconnects to the match owner.

## Edits — `apps/api/src/modules/match/presence.service.ts`

1. **Leader election in the existing interval** (~35-50). At the top of each tick:

   ```ts
   // Fence leadership so a stale leader — even one that restarts with the SAME
   // INSTANCE_ID — cannot be mistaken for the current one. The lease value is
   // `${nodeId}:${fence}`, never bare nodeId. A FRESH acquisition mints a new
   // monotonic fence (INCR presence:leader:fence); while we stay leader we renew
   // with the SAME stored token.
   let token = this.leaderToken; // remembered from our last acquisition
   let isLeader = token
     ? await this.redis.renewLease("presence:leader", token, LEADER_TTL_SEC)
     : false;
   if (!isLeader) {
     const fence = await this.redis.incr("presence:leader:fence");
     token = `${this.cluster.nodeId}:${fence}`;
     isLeader = await this.redis.acquireLease(
       "presence:leader",
       token,
       LEADER_TTL_SEC,
     );
     this.leaderToken = isLeader ? token : undefined;
   }
   if (!isLeader) return; // non-leaders skip the sweep entirely
   ```

   `LEADER_TTL_SEC = 15`, interval 5s (renew 3× before expiry). Leader death → TTL expiry →
   next node's tick `acquireLease` wins with a **higher fence**. Keep `isSweeping` **only** for
   in-process reentrancy (not as an ownership guard). Store `leaderToken` as a private field.
   Using an INCR fence (not `nodeId`) means a demoted leader that re-acquires later gets a
   strictly greater token, so its in-flight mutations from the old epoch fail the fence check even
   if `INSTANCE_ID` was reused.

   **Fence every mutation atomically, not just the tick start.** A sweep iterates many rooms and
   can take longer than the lease TTL, so the acquire/renew at the top is not enough — leadership
   can be lost mid-sweep. A preceding `renewLease` is only a check-then-act: leadership can still
   be lost in the window between the renew and the mutation, so the fence must be enforced **as
   part of the mutation itself**. Carry the **complete leadership token** `${nodeId}:${fence}`
   (the exact value stored in `presence:leader`, minted via the INCR fence above — never bare
   `nodeId`) into each Redis/DB state change and apply the mutation in a transaction / Lua script
   that **re-checks that `presence:leader` still equals this full token and rejects the write when
   it is no longer current** (compare-and-set on the leader key, comparing the whole `nodeId:fence`
   value, inside the same atomic op). Comparing the full token — not just `nodeId` — is what stops
   a stale leader that restarted under a reused `INSTANCE_ID`: its token carries the older fence,
   so the CAS fails. On a rejected fence check, **abort the rest of the sweep immediately** — do
   not
   apply further mutations. `renewLease` at the top of the tick still gates whether this node
   sweeps at all, but the per-mutation fenced CAS is what actually prevents a demoted ex-leader
   from disbanding rooms / removing players while a new leader is also sweeping.

2. **Route IN_GAME disconnects to the owner.** In `sweep`, the lobby-room mutations
   (WAITING/COUNTDOWN/STARTING → `roomService`/Redis) the **leader applies directly** (they don't
   touch a match state machine). But the IN_GAME stale-player branch (~168,
   `gameLoopService.handlePlayerDisconnect` → in-memory state machine mutation) must run on the
   **match owner**, not necessarily the leader:
   - If `ownership.isOwner(matchId)` → apply directly (leader is also owner).
   - Else → forward a **complete immutable `CommandEnvelope`** built via the **shared envelope
     factory** from B4a (do not hand-roll the object here):
     ```ts
     await matchCommand.forward(
       makeCommandEnvelope({
         matchId,
         body: { type: "player_disconnect", userId }, // PlayerDisconnectBody: userId ONLY
       }),
     );
     ```
     The factory stamps the required envelope fields: `eventId` (uuid, the dedup key),
     `schemaVersion: 1`, `emittedByNodeId` (this node), `emittedAt` (epoch ms), plus `matchId`.
     `PlayerDisconnectBody` carries **only `userId`** (B4a's type has no `roomId`) — the owner
     resolves `roomId` from the authoritative match state /
     `MatchService.getRoomIdByMatchId`, never from the command payload, so a stale sweeping
     leader cannot inject a wrong room. The owner's `MatchCommandService.apply` runs
     `handlePlayerDisconnect` (single writer).
     Add the `player_disconnect` case to `MatchCommandService.apply` (B4a left the slot).

## Tests — `presence.service.spec.ts`

- Two instances, one Redis: exactly one acquires `presence:leader` and sweeps; the other skips.
- Kill the leader (stop renewing) → the other acquires within one interval and sweeps.
- IN_GAME stale player: when this node is NOT the owner → `matchCommand.forward` called (not a
  direct `handlePlayerDisconnect`); when it IS the owner → direct call.
- Lobby stale player still handled directly by the leader.
- **Mid-sweep demotion:** leadership lost partway through a sweep — make the **fenced mutation
  primitive** (the per-mutation leader-token CAS from item 1) reject its fence check on the
  **second room**, rather than mocking `renewLease → false` (`renewLease` only gates the tick
  start and does not exercise the per-mutation guard). Assert the sweep stops **immediately after
  the atomic CAS rejection**: the second room's mutation is not applied and no subsequent rooms
  are mutated. Keep a separate case covering the initial gate: tick-start `renewLease`/acquire
  fails → the node skips the sweep entirely.

## Verify / done

- Specs green; full suite green.
- `docker:multi` up with an active match + a player that goes stale: the `room.delete` /
  duplicate-`PLAYER_LEFT` errors from Stage A are **gone** (only the leader sweeps), and the
  IN_GAME disconnect is applied once by the owner.
- **This closes the known Stage-A deferred bug.**
