import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ANTIGRAVITY_SUBAGENT_STRATEGIES,
  ANTIGRAVITY_SUBAGENT_STRATEGY_OPTION,
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
    expect(result.nativeSubagentsEnabled).toBe(false);
  });

  it("respects explicit isolated strategy", () => {
    const result = resolveAntigravitySubagentStrategy(
      "antigravity",
      { [ANTIGRAVITY_SUBAGENT_STRATEGY_OPTION]: "isolated" },
      { nativeSubagentsEnabled: true },
    );
    expect(result.strategy).toBe(ANTIGRAVITY_SUBAGENT_STRATEGIES.isolated);
    expect(result.reason).toBe("explicit_isolated");
  });

  it("falls back to isolated strategy on invalid option value", () => {
    const result = resolveAntigravitySubagentStrategy(
      "antigravity",
      { [ANTIGRAVITY_SUBAGENT_STRATEGY_OPTION]: "invalid-choice" },
      { nativeSubagentsEnabled: true },
    );
    expect(result.strategy).toBe(ANTIGRAVITY_SUBAGENT_STRATEGIES.isolated);
    expect(result.reason).toBe("invalid_fallback");
  });

  it("falls back to isolated strategy when disabled by options", () => {
    const result = resolveAntigravitySubagentStrategy("antigravity", undefined, {
      nativeSubagentsEnabled: false,
    });
    expect(result.strategy).toBe(ANTIGRAVITY_SUBAGENT_STRATEGIES.isolated);
    expect(result.reason).toBe("disabled_by_env");
    expect(result.nativeSubagentsEnabled).toBe(false);
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

  it("returns not ready when projectRoot is missing", () => {
    const readiness = resolveAntigravityNativeSubagentReadiness(null);
    expect(readiness.ready).toBe(false);
    expect(readiness.missingPaths).toEqual([".agents/agents/*.md"]);
  });

  it("provides workflow guidance for implementer", () => {
    const guidance = getAntigravityNativeSubagentWorkflowGuidance("implementer");
    expect(guidance).toContain("implement-worker");
    expect(guidance).toContain("invoke_subagent");
    expect(guidance).toContain('Workspace: "branch"');
  });

  it("provides workflow guidance for planner and reviewer", () => {
    const plannerGuidance = getAntigravityNativeSubagentWorkflowGuidance("planner");
    expect(plannerGuidance).toContain("plan-polisher");

    const reviewerGuidance = getAntigravityNativeSubagentWorkflowGuidance("reviewer");
    expect(reviewerGuidance).toContain("review-sidecar");
  });
});
