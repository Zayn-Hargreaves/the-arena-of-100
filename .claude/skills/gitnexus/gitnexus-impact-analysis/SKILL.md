---
name: gitnexus-impact-analysis
description: 'Use when the user wants to know what will break if they change something, or needs safety analysis before editing code. Examples: "Is it safe to change X?", "What depends on this?", "What will break?"'
---

# Impact Analysis with GitNexus

## When to Use

- "Is it safe to change this function?"
- "What will break if I modify X?"
- "Show me the blast radius"
- "Who uses this code?"
- Before making non-trivial code changes
- Before committing — to understand what your changes affect

## Workflow

```
1. gitnexus_impact({target: "X", direction: "upstream"})  → What depends on this
2. READ gitnexus://repo/{name}/processes                   → Check affected execution flows
3. gitnexus_detect_changes()                               → Map current git changes to affected flows
4. Cross-reference affected flows against the project's critical paths
   (e.g., game state machine, socket events, match lifecycle, room
   management, auth). Concretely: fetch canonical process
   definitions via READ gitnexus://repo/{name}/processes, then run
   gitnexus_detect_changes({scope: "staged"}) to produce the
   affected-flows list, and intersect the two. Any intersection
   with a critical path escalates the risk rating by one tier
   (LOW→MEDIUM, MEDIUM→HIGH, HIGH→CRITICAL).
5. Assess risk and report to user; require explicit confirmation or
   an override flag when escalating to HIGH/CRITICAL.
```

> If "Index is stale" → run `npx gitnexus analyze` in terminal.

## Checklist

```
- [ ] gitnexus_impact({target, direction: "upstream"}) to find dependents
- [ ] Review d=1 items first (these WILL BREAK)
- [ ] Check high-confidence (>0.8) dependencies
- [ ] READ processes to check affected execution flows
- [ ] gitnexus_detect_changes() for pre-commit check
- [ ] Assess risk level and report to user
```

## Understanding Output

| Depth | Risk Level       | Meaning                  |
| ----- | ---------------- | ------------------------ |
| d=1   | **WILL BREAK**   | Direct callers/importers |
| d=2   | LIKELY AFFECTED  | Indirect dependencies    |
| d=3   | MAY NEED TESTING | Transitive effects       |

## Risk Assessment

`symbols` = direct/indirect callers and importers of the changed symbol.
`processes` = distinct execution flows (in the GitNexus process graph) that touch the changed symbol.

| Affected (symbols / processes, i.e. distinct runtime execution flows touching the change) | Risk     |
| ----------------------------------------------------------------------------------------- | -------- |
| <5 symbols, few processes                                                                 | LOW      |
| 5-15 symbols, 2-5 processes                                                               | MEDIUM   |
| >15 symbols or many processes                                                             | HIGH     |
| Critical path (auth, payments)                                                            | CRITICAL |

> Auth-touching changes (validateUser, loginHandler, sessionManager,
> token refresh) are always treated as one tier higher than the raw
> counts imply, because they can compromise account integrity.

## Tools

**gitnexus_impact** — the primary tool for symbol blast radius:

```
gitnexus_impact({
  target: "validateUser",
  direction: "upstream",
  minConfidence: 0.8,
  maxDepth: 3
})

→ d=1 (WILL BREAK):
  - loginHandler (src/auth/login.ts:42) [CALLS, 100%]
  - apiMiddleware (src/api/middleware.ts:15) [CALLS, 100%]

→ d=2 (LIKELY AFFECTED):
  - authRouter (src/routes/auth.ts:22) [CALLS, 95%]
```

**gitnexus_detect_changes** — git-diff based impact analysis:

```
gitnexus_detect_changes({scope: "staged"})

→ Changed: 5 symbols in 3 files
→ Affected: LoginFlow, TokenRefresh, APIMiddlewarePipeline
→ Risk: MEDIUM
```

## Example: "What breaks if I change validateUser?"

```
1. gitnexus_impact({target: "validateUser", direction: "upstream"})
   → d=1: loginHandler, apiMiddleware (WILL BREAK)
   → d=2: authRouter, sessionManager (LIKELY AFFECTED)

2. READ gitnexus://repo/my-app/processes
   → LoginFlow and TokenRefresh touch validateUser

3. Risk: 2 direct callers + 2 indirect = 4 symbols, 2 processes = LOW
   by the table, but escalated to MEDIUM (one tier) because
   validateUser and the symbols in LoginFlow/TokenRefresh are on
   the auth critical path. A non-auth change with the same shape
   would stay LOW.
```
