# Antigravity Native Subagents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable native multi-subagent execution for Google Antigravity in `@aif/runtime` and `@aif/agent` following the exact architectural blueprint of Claude Code and Codex (in-engine coordination, isolated branches, and parent reconciliation).

**Architecture:**

1. Add an Antigravity subagent strategy and readiness checker (`packages/runtime/src/adapters/antigravity/subagentStrategy.ts`) verifying the presence of `.agents/agents/*.md`.
2. Update `@aif/runtime/src/promptPolicy.ts` so `supportsNativeSubagentWorkflow` supports Antigravity alongside Codex, constructing native prompts with `invoke_subagent` and `Workspace: "branch"` instructions.
3. Wire the strategy into `packages/agent/src/subagentQuery.ts` to execute `implement-coordinator` when `useSubagents: true`.

**Tech Stack:** TypeScript, Vitest, Node.js child_process, `@aif/runtime`, `@aif/agent`, `@aif/shared`.

---

## Global Constraints

- Every package must maintain at least 70% test coverage.
- Write code following SOLID and DRY principles.
- DB boundary is mandatory: `api`, `agent`, and `runtime` access database only through `@aif/data`.
- Never combine shell commands with `&&`, `||`, or `;` — execute each command as a separate call.
- All code, technical terms, and comments in English; user chat in Ukrainian.
- Always run after implementation: `npm run ai:validate`.

---

## Task 1: Antigravity Subagent Strategy & Readiness Module (`@aif/runtime`)

**Files:**

- Create: `packages/runtime/src/adapters/antigravity/subagentStrategy.ts`
- Test: `packages/runtime/src/__tests__/antigravitySubagentStrategy.test.ts`
- Modify: `packages/runtime/src/adapters/antigravity/index.ts`
- Modify: `packages/runtime/src/index.ts`

**Interfaces:**

- Consumes: `RuntimeWorkflowKind`, `asRecord`, `readString` from `packages/runtime/src/utils.js`.
- Produces:
  - `resolveAntigravitySubagentStrategy(runtimeId: string, runtimeOptions?: Record<string, unknown>, options?: { nativeSubagentsEnabled?: boolean }): AntigravitySubagentStrategyResolution`
  - `resolveAntigravityNativeSubagentReadiness(projectRoot?: string | null): AntigravityNativeSubagentReadiness`
  - `getAntigravityNativeSubagentWorkflowGuidance(workflowKind: RuntimeWorkflowKind): string`

- [ ] **Step 1: Write failing tests for Antigravity subagent strategy & readiness**

Create `packages/runtime/src/__tests__/antigravitySubagentStrategy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ANTIGRAVITY_SUBAGENT_STRATEGIES,
  resolveAntigravitySubagentStrategy,
  resolveAntigravityNativeSubagentReadiness,
  getAntigravityNativeSubagentWorkflowGuidance,
} from "../adapters/antigravity/subagentStrategy.js";

describe("Antigravity subagent strategy", () => {
  it("resolves default native strategy for antigravity runtime when enabled", () => {
    const result = resolveAntigravitySubagentStrategy("antigravity", undefined, {
      nativeSubagentsEnabled: true,
    });
    expect(result.strategy).toBe(ANTIGRAVITY_SUBAGENT_STRATEGIES.native);
    expect(result.reason).toBe("default_native");
    expect(result.nativeSubagentsEnabled).toBe(true);
  });

  it("returns non_antigravity for other runtimes", () => {
    const result = resolveAntigravitySubagentStrategy("codex");
    expect(result.strategy).toBeNull();
    expect(result.reason).toBe("non_antigravity");
  });

  it("checks readiness of agent markdown files in .agents/agents", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "aif-agy-agents-"));
    const agentsDir = join(tempRoot, ".agents", "agents");
    mkdirSync(agentsDir, { recursive: true });

    const initialReadiness = resolveAntigravityNativeSubagentReadiness(tempRoot);
    expect(initialReadiness.ready).toBe(false);
    expect(initialReadiness.missingPaths.length).toBeGreaterThan(0);

    for (const file of [
      "best-practices-sidecar.md",
      "commit-preparer.md",
      "docs-auditor.md",
      "implement-coordinator.md",
      "implement-worker.md",
      "plan-coordinator.md",
      "plan-polisher.md",
      "review-sidecar.md",
      "rules-sidecar.md",
      "security-sidecar.md",
    ]) {
      writeFileSync(join(agentsDir, file), `---\nname: ${file}\n---\n`, "utf8");
    }

    const readyState = resolveAntigravityNativeSubagentReadiness(tempRoot);
    expect(readyState.ready).toBe(true);
    expect(readyState.missingPaths).toEqual([]);
  });

  it("provides workflow guidance for implementer", () => {
    const guidance = getAntigravityNativeSubagentWorkflowGuidance("implementer");
    expect(guidance).toContain("implement-worker");
    expect(guidance).toContain("invoke_subagent");
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npm test -w @aif/runtime -- packages/runtime/src/__tests__/antigravitySubagentStrategy.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement `packages/runtime/src/adapters/antigravity/subagentStrategy.ts`**

Implement the strategy, readiness check, and workflow guidance mirroring Codex's pattern but adapted for `.agents/agents/*.md` and `invoke_subagent`.

- [ ] **Step 4: Export from adapter index and package index**

Modify `packages/runtime/src/adapters/antigravity/index.ts` and `packages/runtime/src/index.ts` to re-export the strategy types and functions.

- [ ] **Step 5: Run tests to verify they pass**

Run:

```bash
npm test -w @aif/runtime -- packages/runtime/src/__tests__/antigravitySubagentStrategy.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add packages/runtime/src/adapters/antigravity/subagentStrategy.ts packages/runtime/src/__tests__/antigravitySubagentStrategy.test.ts packages/runtime/src/adapters/antigravity/index.ts packages/runtime/src/index.ts
git commit -m "feat(runtime): add Antigravity subagent strategy and readiness resolution"
```

---

## Task 2: Runtime Prompt Policy Expansion for Antigravity (`@aif/runtime`)

**Files:**

- Modify: `packages/runtime/src/promptPolicy.ts`
- Modify: `packages/runtime/src/__tests__/workflowSpec.test.ts`

**Interfaces:**

- Consumes: `resolveAntigravitySubagentStrategy`, `resolveAntigravityNativeSubagentReadiness`, `getAntigravityNativeSubagentWorkflowGuidance` from `adapters/antigravity/subagentStrategy.js`.
- Produces: Updated `resolveRuntimePromptPolicy` handling `antigravity` with native subagent prompt construction.

- [ ] **Step 1: Add failing test cases in `packages/runtime/src/__tests__/workflowSpec.test.ts`**

Add tests:

- `uses native Antigravity subagents when runtime supports them and assets exist`.
- `falls back to slash command when Antigravity native assets are missing`.
- Verify the generated prompt contains `invoke_subagent` and `Workspace: "branch"`.

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -w @aif/runtime -- packages/runtime/src/__tests__/workflowSpec.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Update `packages/runtime/src/promptPolicy.ts`**

1. Evaluate `supportsNativeSubagentWorkflow` for both `codex` and `antigravity`:

```ts
  const isCodex = input.runtimeId === "codex";
  const isAntigravity = input.runtimeId === "antigravity";

  const codexStrategy = isCodex ? resolveCodexSubagentStrategy(...) : null;
  const codexReadiness = isCodex ? resolveCodexNativeSubagentReadiness(input.projectRoot) : null;

  const antigravityStrategy = isAntigravity ? resolveAntigravitySubagentStrategy(...) : null;
  const antigravityReadiness = isAntigravity ? resolveAntigravityNativeSubagentReadiness(input.projectRoot) : null;

  const supportsNativeSubagentWorkflow =
    Boolean(input.capabilities.supportsNativeSubagentWorkflows) &&
    ((isCodex && codexStrategy?.strategy === CODEX_SUBAGENT_STRATEGIES.native && codexReadiness?.ready === true) ||
     (isAntigravity && antigravityStrategy?.strategy === ANTIGRAVITY_SUBAGENT_STRATEGIES.native && antigravityReadiness?.ready === true));
```

2. Build runtime-specific prompt in `prependNativeSubagentPrompt(input, workflow, prompt, agentDefinitionName)`:

- For `antigravity`: instructions mentioning `invoke_subagent`, `Workspace: "branch"`, and `send_message`.
- For `codex`: instructions mentioning Codex native subagents.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npm test -w @aif/runtime -- packages/runtime/src/__tests__/workflowSpec.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add packages/runtime/src/promptPolicy.ts packages/runtime/src/__tests__/workflowSpec.test.ts
git commit -m "feat(runtime): support Antigravity native subagent prompt policy and delegation"
```

---

## Task 3: Agent Subagent Query Integration (`@aif/agent`)

**Files:**

- Modify: `packages/agent/src/subagentQuery.ts`

- [ ] **Step 1: Update `subagentQuery.ts` prompt policy input**

Pass `antigravityNativeSubagentsEnabled: true` to `resolveRuntimePromptPolicy`:

```ts
  const promptPolicy = resolveRuntimePromptPolicy({
    runtimeId: resolved.runtimeId,
    projectRoot: options.projectRoot,
    capabilities,
    runtimeOptions: resolved.options,
    workflow,
    codexNativeSubagentsEnabled: getEnv().AIF_RUNTIME_CODEX_NATIVE_SUBAGENTS_ENABLED,
    antigravityNativeSubagentsEnabled: true,
    logger: ...
  });
```

- [ ] **Step 2: Run agent package tests**

Run:

```bash
npm test -w @aif/agent
```

Expected: PASS.

- [ ] **Step 3: Commit Task 3**

```bash
git add packages/agent/src/subagentQuery.ts
git commit -m "feat(agent): wire Antigravity native subagent enablement into subagentQuery"
```

---

## Task 4: Full Suite Validation

- [ ] **Step 1: Run all tests across the workspace**

```bash
npm test
```

- [ ] **Step 2: Run AI validation script**

```bash
npm run ai:validate
```

Expected: PASS (lint, types, tests, coverage check >= 70%).

- [ ] **Step 3: Final Commit**

```bash
git commit --allow-empty -m "chore: verify Antigravity native subagent pipeline passes ai:validate"
```
