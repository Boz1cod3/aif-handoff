import { existsSync } from "node:fs";
import { join } from "node:path";
import type { RuntimeWorkflowKind } from "../../workflowSpec.js";
import { asRecord, readString } from "../../utils.js";

export const ANTIGRAVITY_SUBAGENT_STRATEGY_OPTION = "antigravitySubagentStrategy";

export const ANTIGRAVITY_SUBAGENT_STRATEGIES = {
  native: "native",
  isolated: "isolated",
} as const;

export type AntigravitySubagentStrategy =
  (typeof ANTIGRAVITY_SUBAGENT_STRATEGIES)[keyof typeof ANTIGRAVITY_SUBAGENT_STRATEGIES];

export type AntigravitySubagentStrategyResolutionReason =
  | "non_antigravity"
  | "default_native"
  | "explicit_native"
  | "explicit_isolated"
  | "invalid_fallback"
  | "disabled_by_env";

export interface AntigravitySubagentStrategyResolution {
  strategy: AntigravitySubagentStrategy | null;
  reason: AntigravitySubagentStrategyResolutionReason;
  configuredValue?: string;
  nativeSubagentsEnabled: boolean;
}

// Keep this list in lockstep with the Antigravity assets materialized by ai-factory.
export const ANTIGRAVITY_NATIVE_AGENT_FILES = [
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
] as const;

export interface AntigravityNativeSubagentReadiness {
  ready: boolean;
  missingPaths: string[];
}

export function resolveAntigravitySubagentStrategy(
  runtimeId: string,
  runtimeOptions?: Record<string, unknown>,
  options?: { nativeSubagentsEnabled?: boolean },
): AntigravitySubagentStrategyResolution {
  if (runtimeId !== "antigravity") {
    return {
      strategy: null,
      reason: "non_antigravity",
      nativeSubagentsEnabled: false,
    };
  }

  const configured = readString(asRecord(runtimeOptions)[ANTIGRAVITY_SUBAGENT_STRATEGY_OPTION]);
  if (configured === ANTIGRAVITY_SUBAGENT_STRATEGIES.isolated) {
    return {
      strategy: ANTIGRAVITY_SUBAGENT_STRATEGIES.isolated,
      reason: "explicit_isolated",
      configuredValue: configured,
      nativeSubagentsEnabled: Boolean(options?.nativeSubagentsEnabled),
    };
  }

  if (configured && configured !== ANTIGRAVITY_SUBAGENT_STRATEGIES.native) {
    return {
      strategy: ANTIGRAVITY_SUBAGENT_STRATEGIES.isolated,
      reason: "invalid_fallback",
      configuredValue: configured,
      nativeSubagentsEnabled: Boolean(options?.nativeSubagentsEnabled),
    };
  }

  if (options?.nativeSubagentsEnabled === false) {
    return {
      strategy: ANTIGRAVITY_SUBAGENT_STRATEGIES.isolated,
      reason: "disabled_by_env",
      configuredValue: configured ?? undefined,
      nativeSubagentsEnabled: false,
    };
  }

  return {
    strategy: ANTIGRAVITY_SUBAGENT_STRATEGIES.native,
    reason: configured ? "explicit_native" : "default_native",
    configuredValue: configured ?? undefined,
    nativeSubagentsEnabled: true,
  };
}

export function resolveAntigravityNativeSubagentReadiness(
  projectRoot?: string | null,
): AntigravityNativeSubagentReadiness {
  if (!projectRoot) {
    return {
      ready: false,
      missingPaths: [".agents/agents/*.md"],
    };
  }

  const missingPaths: string[] = [];

  for (const fileName of ANTIGRAVITY_NATIVE_AGENT_FILES) {
    const workspacePath = join(projectRoot, ".agents", "agents", fileName);
    const aiFactoryPath = join(projectRoot, "subagents", "antigravity", "agents", fileName);

    if (!existsSync(workspacePath) && !existsSync(aiFactoryPath)) {
      missingPaths.push(`.agents/agents/${fileName}`);
    }
  }

  return {
    ready: missingPaths.length === 0,
    missingPaths,
  };
}

const ANTIGRAVITY_NATIVE_SUBAGENT_WORKFLOW_GUIDANCE: Partial<Record<RuntimeWorkflowKind, string>> =
  {
    planner:
      'Use "plan-polisher" for bounded critique/refinement passes via invoke_subagent when helpful, then return the final implementation-ready plan in the parent thread.',
    implementer:
      'Parse the plan, identify independent task groups, and dispatch "implement-worker" concurrently via invoke_subagent with Workspace: "branch". Collect worker results, merge branches, verify code, and run quality sidecars before returning the final result.',
    reviewer:
      'Return only the consolidated findings from the delegated "review-sidecar" run via invoke_subagent.',
    "review-security":
      'Return only the consolidated findings from the delegated "security-sidecar" run via invoke_subagent.',
  };

export function getAntigravityNativeSubagentWorkflowGuidance(
  workflowKind: RuntimeWorkflowKind,
): string {
  return (
    ANTIGRAVITY_NATIVE_SUBAGENT_WORKFLOW_GUIDANCE[workflowKind] ??
    "Delegate work to the named custom agent and keep the final response in the parent thread."
  );
}
