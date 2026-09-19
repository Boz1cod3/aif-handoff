# Google Antigravity Adapter Remediation and Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve all 4 review issues from PR #184 (process tree cleanup on abort/timeout, cross-platform CI test isolation, UTF-8 chunk corruption, and model error classification), deliver prompts safely via STDIN, fix provider documentation discrepancies, and raise test branch coverage above the required 70% threshold.

**Architecture:** Harden the Antigravity CLI adapter (`@aif/runtime`) through:

1. Process lifecycle controls: `detached: !IS_WINDOWS` for POSIX process group signaling and synchronous `taskkill /T /F` on Windows, intercepting `child.kill` so shared timeout handlers (`withProcessTimeouts`) and abort signals terminate entire process hierarchies without hanging on inherited stdout/stderr pipes.
2. Stream safety: Replace naive `String(chunk)` on buffers with `StringDecoder("utf8")` for stdout and stderr to guarantee Unicode integrity across arbitrary socket chunk boundaries.
3. Structured error classification: Remove ambiguous string patterns (`not recognized`), handle binary missing via `err.code === "ENOENT"`, classify model errors as `model_not_found`, and eliminate redundant pattern arrays in favor of shared fallbacks.
4. Input robustness: Switch prompt delivery from the command-line argument `-p` to `child.stdin` to eliminate Windows `CreateProcessW` 32,767 character limits.
5. Cross-platform test resilience: Gate live E2E runs under `TEST_ANTIGRAVITY_INTEGRATION=1`, make batch script rejection cross-platform in `findPath.ts`, and add unit test coverage for edge cases to achieve >= 70% branch coverage.

**Tech Stack:** TypeScript (ES2022, ESNext), Node.js (`child_process`, `string_decoder`, `os`, `path`), Vitest (`@vitest/coverage-v8`), npm workspaces.

**Spec:** PR #184 review comment (`https://github.com/lee-to/aif-handoff/pull/184#issuecomment-5732212195`), [AGENTS.md](../../../AGENTS.md), [docs/providers.md](../../providers.md).

## Global Constraints

- Never combine shell commands with `&&`, `||`, or `;` — execute each command as a separate tool call.
- DB boundary: access database only through `@aif/data`.
- Keep `@aif/runtime` and the Antigravity adapter at or above 70% branch and statement test coverage.
- All error classification must use structured properties (`category`, `adapterCode`, `err.code`) rather than arbitrary string matches for control flow.
- Follow the Nullable Cast Rule: never use `as unknown as T` to hide null returns; declare types explicitly and guard against null.
- Run `npm run ai:validate` after all tasks are completed.

---

### Task 1: Isolate E2E Pipeline Test and Normalize Batch Script Rejection

**Files:**

- Modify: `packages/runtime/src/__tests__/antigravityPipeline.e2e.test.ts:1-75`
- Modify: `packages/runtime/src/adapters/antigravity/findPath.ts:72-88`
- Test: `packages/runtime/src/adapters/antigravity/__tests__/antigravity.test.ts`

**Interfaces:**

- Produces: `probeAntigravityCli(cliPath: string): { ok: boolean; version?: string; error?: string }` rejecting `.cmd` and `.bat` across all operating systems.
- Consumes: `process.env.TEST_ANTIGRAVITY_INTEGRATION` in test runners.

- [ ] **Step 1: Update findPath.ts to enforce batch script rejection cross-platform**

In `packages/runtime/src/adapters/antigravity/findPath.ts`, move the `.cmd` / `.bat` extension check outside of `if (IS_WINDOWS)`:

```typescript
export function probeAntigravityCli(cliPath: string): {
  ok: boolean;
  version?: string;
  error?: string;
} {
  try {
    const lower = cliPath.toLowerCase();
    if (lower.endsWith(".cmd") || lower.endsWith(".bat")) {
      return {
        ok: false,
        error: `Executing Antigravity via batch script (${cliPath}) is prohibited. Point directly to agy.exe.`,
      };
    }
    if (IS_WINDOWS) {
      assertSafeWindowsShellExecutablePath(cliPath, "Antigravity CLI path");
    }
    const out = execFileSync(cliPath, ["--version"], {
      timeout: 5_000,
      shell: false,
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, version: out.trim() };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
```

- [ ] **Step 2: Gate live E2E pipeline tests behind TEST_ANTIGRAVITY_INTEGRATION**

In `packages/runtime/src/__tests__/antigravityPipeline.e2e.test.ts`, wrap the live stages in `describe.runIf(Boolean(process.env.TEST_ANTIGRAVITY_INTEGRATION))`:

```typescript
const hasLiveCli = Boolean(process.env.TEST_ANTIGRAVITY_INTEGRATION);

describe("Antigravity Pipeline Verification", () => {
  describe("Registration & Security", () => {
    it("1.1 успішно реєструє antigravity в bootstrapRuntimeRegistry", async () => {
      const registry = await bootstrapRuntimeRegistry();
      const adapter = registry.resolveRuntime("antigravity");
      expect(adapter).toBeDefined();
      expect(adapter.descriptor.id).toBe("antigravity");
    });

    it("1.4 захист від ін'єкцій: блокує виконання .cmd / .bat файлів", async () => {
      const adapter = createAntigravityRuntimeAdapter();
      const res = await adapter.validateConnection!({
        runtimeId: "antigravity",
        options: { antigravityCliPath: "C:\\malicious\\script.cmd" },
      });
      expect(res.ok).toBe(false);
      expect(res.message).toContain("Executing Antigravity via batch script");
    });
  });

  describe.runIf(hasLiveCli)("Live Pipeline Verification", () => {
    // Stage 1.2, 1.3, 2.1, 3.1, 4.1, 5.1
  });
});
```

- [ ] **Step 3: Run Vitest to verify tests pass without requiring agy installed**

Run:

```bash
npm test --workspace=@aif/runtime -- antigravityPipeline.e2e.test.ts antigravity.test.ts
```

Expected: PASS with live stages skipped when `TEST_ANTIGRAVITY_INTEGRATION` is unset.

- [ ] **Step 4: Commit**

```bash
git add packages/runtime/src/__tests__/antigravityPipeline.e2e.test.ts packages/runtime/src/adapters/antigravity/findPath.ts
```

```bash
git commit -m "fix(runtime/antigravity): gate live e2e tests and make batch script validation cross-platform"
```

---

### Task 2: Protect Unicode Streaming Output Using StringDecoder

**Files:**

- Modify: `packages/runtime/src/adapters/antigravity/cli.ts:430-465`
- Test: `packages/runtime/src/adapters/antigravity/__tests__/antigravityCli.test.ts`

**Interfaces:**

- Produces: Safe UTF-8 decoding for streaming NDJSON line buffers across multi-byte chunk boundaries.
- Consumes: `StringDecoder` from `node:string_decoder`.

- [ ] **Step 1: Add a unit test verifying multi-byte UTF-8 split handling**

In `packages/runtime/src/adapters/antigravity/__tests__/antigravityCli.test.ts`, add a test that sends a split Cyrillic message (e.g. `Привет` split into two arbitrary byte buffers) through the child stream mock and asserts `state.outputText` is intact without replacement characters (`\uFFFD`).

- [ ] **Step 2: Run test to verify current implementation fails or produces unicode replacement characters**

Run:

```bash
npm test --workspace=@aif/runtime -- antigravityCli.test.ts
```

- [ ] **Step 3: Implement StringDecoder in cli.ts for stdout and stderr**

In `packages/runtime/src/adapters/antigravity/cli.ts`:

1. Import `StringDecoder`:
   ```typescript
   import { StringDecoder } from "node:string_decoder";
   ```
2. Instantiate decoders for the subprocess run:
   ```typescript
   const stdoutDecoder = new StringDecoder("utf8");
   const stderrDecoder = new StringDecoder("utf8");
   ```
3. Update `child.stdout.on("data")` and `child.stderr.on("data")`:

   ```typescript
   child.stdout!.on("data", (chunk: Buffer | string) => {
     stdoutBuffer += typeof chunk === "string" ? chunk : stdoutDecoder.write(chunk);
     try {
       flushCompleteLines();
     } catch (err) {
       streamProcessingError = err;
       logger?.error?.(
         { runtimeId: input.runtimeId, err },
         "Antigravity CLI stream-json processing error",
       );
       if (child.pid) killProcessTree(child.pid);
       else child.kill("SIGTERM");
     }
   });

   child.stderr!.on("data", (chunk: Buffer | string) => {
     const text = typeof chunk === "string" ? chunk : stderrDecoder.write(chunk);
     stderr += text;
     execution?.onStderr?.(text);
   });
   ```

4. Flush remaining bytes in `child.on("close")`:
   ```typescript
   stdoutBuffer += stdoutDecoder.end();
   stderr += stderrDecoder.end();
   ```

- [ ] **Step 4: Run test to verify pass**

Run:

```bash
npm test --workspace=@aif/runtime -- antigravityCli.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/adapters/antigravity/cli.ts packages/runtime/src/adapters/antigravity/__tests__/antigravityCli.test.ts
```

```bash
git commit -m "fix(runtime/antigravity): decode subprocess stdout and stderr via StringDecoder to preserve UTF-8"
```

---

### Task 3: Refactor Error Classification for Models and ENOENT CLI Detection

**Files:**

- Modify: `packages/runtime/src/adapters/antigravity/errors.ts:1-75`
- Modify: `packages/runtime/src/adapters/antigravity/index.ts:135-155`
- Test: `packages/runtime/src/adapters/antigravity/__tests__/antigravity.test.ts`

**Interfaces:**

- Produces: `classifyAntigravityRuntimeError(error: unknown, httpStatus?: number, metadata?: RuntimeExecutionErrorMetadata): AntigravityRuntimeAdapterError`
- Classifies:
  - `(error as NodeJS.ErrnoException).code === "ENOENT"` -> `adapterCode: "ANTIGRAVITY_CLI_NOT_FOUND"`, `category: "transport"`
  - `model ... not recognized` or `invalid model selection` -> `adapterCode: "ANTIGRAVITY_MODEL_NOT_FOUND"`, `category: "model_not_found"`
  - Falls back to `classifyByMessageFallback` from `../../errors.js` instead of maintaining duplicate arrays.

- [ ] **Step 1: Add unit tests for model not recognized vs CLI missing**

In `packages/runtime/src/adapters/antigravity/__tests__/antigravity.test.ts`, add tests:

1. `classifyAntigravityRuntimeError(new Error("error: invalid model selection (--model \"unknown-model\"): model unknown-model is not recognized"))` must produce `category: "model_not_found"` and `adapterCode: "ANTIGRAVITY_MODEL_NOT_FOUND"`.
2. `classifyAntigravityRuntimeError(Object.assign(new Error("spawn agy ENOENT"), { code: "ENOENT" }))` must produce `category: "transport"` and `adapterCode: "ANTIGRAVITY_CLI_NOT_FOUND"`.
3. `diagnoseError(new Error("model foo is not recognized"))` must diagnose as model error rather than advising binary installation.

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npm test --workspace=@aif/runtime -- antigravity.test.ts
```

Expected: FAIL on model classification producing `transport` instead of `model_not_found`.

- [ ] **Step 3: Update errors.ts and index.ts**

1. In `packages/runtime/src/adapters/antigravity/errors.ts`:
   - Remove `"not recognized"` from `CLI_NOT_FOUND_PATTERNS`.
   - Remove duplicate arrays `CAPACITY_PATTERNS`, `QUOTA_PATTERNS`, `AUTH_PATTERNS`.
   - Check `(error as { code?: string })?.code === "ENOENT"` directly in `classifyAntigravityRuntimeError`.
   - Add model error pattern check:
     ```typescript
     if (
       lowered.includes("invalid model selection") ||
       (lowered.includes("model") &&
         (lowered.includes("not recognized") || lowered.includes("not found")))
     ) {
       return { adapterCode: "ANTIGRAVITY_MODEL_NOT_FOUND", category: "model_not_found" };
     }
     ```
   - Delegate remaining patterns to `classifyByMessageFallback(message)`.
2. In `packages/runtime/src/adapters/antigravity/index.ts`:
   - Update `diagnoseError` to prioritize `model` errors before checking CLI missing.

- [ ] **Step 4: Run test to verify pass**

Run:

```bash
npm test --workspace=@aif/runtime -- antigravity.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/adapters/antigravity/errors.ts packages/runtime/src/adapters/antigravity/index.ts packages/runtime/src/adapters/antigravity/__tests__/antigravity.test.ts
```

```bash
git commit -m "fix(runtime/antigravity): distinguish unknown model errors from missing CLI binary and remove duplicate error patterns"
```

---

### Task 4: Complete Process Tree Termination & Timeouts (POSIX Detached & Windows Sync Taskkill)

**Files:**

- Modify: `packages/runtime/src/adapters/antigravity/cli.ts:35-45, 115-135, 400-420, 520-530`
- Test: `packages/runtime/src/adapters/antigravity/__tests__/antigravityCli.test.ts`

**Interfaces:**

- Produces: `spawnSubprocess` with `detached: !IS_WINDOWS`.
- Produces: Synchronous `taskkill /PID ${pid} /T /F` on Windows and `process.kill(-pid, "SIGKILL")` on POSIX.
- Produces: Intercepted `child.kill` ensuring tree termination across all timeout and abort triggers.
- Produces: Nullable-safe `CliAttemptResult` type: `{ result: RuntimeRunResult | null; startTimedOut: boolean }`.

- [ ] **Step 1: Write unit tests verifying tree kill and timeout invocation**

In `packages/runtime/src/adapters/antigravity/__tests__/antigravityCli.test.ts`:

1. Assert `spawn` is called with `detached: !IS_WINDOWS`.
2. Assert when `child.kill()` is called by `withProcessTimeouts`, `killProcessTree` terminates children.
3. Assert `CliAttemptResult` handles `null` result cleanly without `as unknown as RuntimeRunResult`.

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npm test --workspace=@aif/runtime -- antigravityCli.test.ts
```

- [ ] **Step 3: Implement process tree killing and child.kill wrapping in cli.ts**

1. In `spawnSubprocess`:
   ```typescript
   return spawn(cliPath, args, {
     cwd,
     shell: false,
     windowsHide: true,
     env,
     detached: !IS_WINDOWS,
   });
   ```
2. In `killProcessTree`:
   ```typescript
   function killProcessTree(pid: number): void {
     if (IS_WINDOWS) {
       try {
         spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
           windowsHide: true,
           stdio: "ignore",
         });
       } catch {
         // ignore
       }
     } else {
       try {
         process.kill(-pid, "SIGKILL");
       } catch {
         try {
           process.kill(pid, "SIGKILL");
         } catch {
           // ignore
         }
       }
     }
   }
   ```
3. Immediately after `const child = spawnSubprocess(...)` in `runCliAttempt`:
   ```typescript
   const rawKill = child.kill.bind(child);
   child.kill = ((signal?: NodeJS.Signals | number) => {
     if (child.pid) killProcessTree(child.pid);
     return IS_WINDOWS ? true : rawKill(signal as any);
   }) as any;
   ```
4. Update `CliAttemptResult` and lines 520-530:
   ```typescript
   interface CliAttemptResult {
     result: RuntimeRunResult | null;
     startTimedOut: boolean;
   }
   ```
   Replace `null as unknown as RuntimeRunResult` with `null`, and guard caller accordingly.

- [ ] **Step 4: Run test to verify pass**

Run:

```bash
npm test --workspace=@aif/runtime -- antigravityCli.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/adapters/antigravity/cli.ts packages/runtime/src/adapters/antigravity/__tests__/antigravityCli.test.ts
```

```bash
git commit -m "fix(runtime/antigravity): terminate process trees reliably across POSIX and Windows on cancel and timeout"
```

---

### Task 5: Deliver Prompts via STDIN to Prevent Windows 32K Command-Line Limit

**Files:**

- Modify: `packages/runtime/src/adapters/antigravity/cli.ts:335-375, 455-465`
- Test: `packages/runtime/src/adapters/antigravity/__tests__/antigravityCli.test.ts`

**Interfaces:**

- Produces: CLI args without `-p`, writing prompt safely into `child.stdin`.

- [ ] **Step 1: Add a test asserting prompt is written to child.stdin instead of CLI args**

In `packages/runtime/src/adapters/antigravity/__tests__/antigravityCli.test.ts`:
Assert that `spawn` is invoked with args that do NOT contain `-p` or `--prompt`, and verify `child.stdin.write` received the composed prompt.

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npm test --workspace=@aif/runtime -- antigravityCli.test.ts
```

Expected: FAIL because current code puts `-p` in args.

- [ ] **Step 3: Update buildCliArgs and stdin writing in cli.ts**

1. In `buildCliArgs`:
   Remove:
   ```typescript
   if (fullPrompt) {
     args.push("-p", fullPrompt);
   }
   ```
2. In `runCliAttempt`:
   ```typescript
   if (fullPrompt) {
     child.stdin!.write(fullPrompt);
   }
   child.stdin!.end();
   ```

- [ ] **Step 4: Run test to verify pass**

Run:

```bash
npm test --workspace=@aif/runtime -- antigravityCli.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/adapters/antigravity/cli.ts packages/runtime/src/adapters/antigravity/__tests__/antigravityCli.test.ts
```

```bash
git commit -m "fix(runtime/antigravity): deliver prompt through stdin to avoid command line length limits"
```

---

### Task 6: Update Provider Documentation and Expand Coverage to >= 70%

**Files:**

- Modify: `docs/providers.md:66, 73-83, 446-455`
- Create/Modify: `packages/runtime/src/adapters/antigravity/__tests__/antigravityCoverage.test.ts`
- Test: All Antigravity tests with coverage.

**Interfaces:**

- Produces: Accurate documentation in `docs/providers.md` matching reality (`gemini-3.8-flash-low`, bypass semantics, effort discovery).
- Produces: Branch coverage >= 70% across all Antigravity adapter files.

- [ ] **Step 1: Correct and complement docs/providers.md**

1. In `docs/providers.md` line 66:
   Replace `gemini-3.8-flash-fast` with `gemini-3.8-flash-low`.
2. In table `Model-specific effort discovery` (around line 77):
   Add row:
   `| Antigravity | agy list-models / settings metadata | effort |`
3. In table `Bypass semantics` (around line 446):
   Add Antigravity row:
   `| Antigravity CLI | --dangerously-skip-permissions |`

- [ ] **Step 2: Add unit tests covering findPath, diagnoseError, and retry edges**

Create or extend `packages/runtime/src/adapters/antigravity/__tests__/antigravityCoverage.test.ts` to test:

1. `findAntigravityCliPath` with `PATH` traversal and fallback paths.
2. `diagnoseError` with all branches (`model`, `ENOENT`, `auth`, `rate_limit`).
3. `cli.ts` start timeout retry logic.

- [ ] **Step 3: Run Vitest with coverage report**

Run:

```bash
npx vitest run --coverage packages/runtime/src/adapters/antigravity
```

Expected: All files in `packages/runtime/src/adapters/antigravity/` have >= 70% branch and statement coverage.

- [ ] **Step 4: Run workspace validation**

Run:

```bash
npm run ai:validate
```

Expected: All linting, formatting, and unit tests pass across the repository.

- [ ] **Step 5: Commit**

```bash
git add docs/providers.md packages/runtime/src/adapters/antigravity/__tests__/
```

```bash
git commit -m "docs(runtime/antigravity): align provider docs and expand unit test coverage above 70%"
```
