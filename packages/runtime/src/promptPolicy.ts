import type { RuntimeCapabilities } from "./types.js";
import type { RuntimeWorkflowSpec } from "./workflowSpec.js";
import {
  CODEX_SUBAGENT_STRATEGIES,
  getNativeSubagentWorkflowGuidance,
  resolveCodexNativeSubagentReadiness,
  resolveCodexSubagentStrategy,
} from "./adapters/codex/subagentStrategy.js";
import {
  ANTIGRAVITY_SUBAGENT_STRATEGIES,
  getAntigravityNativeSubagentWorkflowGuidance,
  resolveAntigravityNativeSubagentReadiness,
  resolveAntigravitySubagentStrategy,
} from "./adapters/antigravity/subagentStrategy.js";

export interface RuntimePromptPolicyLogger {
  debug?(context: Record<string, unknown>, message: string): void;
  warn?(context: Record<string, unknown>, message: string): void;
}

export interface RuntimePromptPolicyInput {
  runtimeId: string;
  projectRoot?: string | null;
  capabilities: RuntimeCapabilities;
  runtimeOptions?: Record<string, unknown>;
  workflow: RuntimeWorkflowSpec;
  codexNativeSubagentsEnabled?: boolean;
  antigravityNativeSubagentsEnabled?: boolean;
  logger?: RuntimePromptPolicyLogger;
}

export interface RuntimePromptPolicyResult {
  prompt: string;
  systemPromptAppend: string;
  agentDefinitionName?: string;
  usedFallbackSlashCommand: boolean;
  usedIsolatedSkillCommand: boolean;
  usedNativeSubagentWorkflow: boolean;
  nativeSubagentFallbackReason?: string;
}

const DEFAULT_SKILL_PREFIX = "/";

/**
 * Pattern matching skill command invocations in prompts.
 * Matches "/aif-<name>" at word boundaries (start of line or after whitespace).
 * The pattern captures the "/" prefix so it can be replaced with the runtime-specific prefix.
 */
const SKILL_COMMAND_PATTERN = /(?<=^|\s)\/(?=aif-)/gm;

/**
 * Transform skill command prefixes in text from the default "/" to the runtime-specific prefix.
 * Only transforms when the target prefix differs from the default.
 */
export function transformSkillCommandPrefix(text: string, prefix: string): string {
  if (!prefix || prefix === DEFAULT_SKILL_PREFIX) return text;
  return text.replace(SKILL_COMMAND_PATTERN, prefix);
}

function prependSlashFallbackPrompt(prompt: string, fallbackSlashCommand: string): string {
  const trimmedCommand = fallbackSlashCommand.trim();
  if (!trimmedCommand) return prompt;

  const trimmedPrompt = prompt.trim();
  if (trimmedPrompt.startsWith(trimmedCommand)) return prompt;
  return `${trimmedCommand}\n\n${prompt}`;
}

function prependNativeSubagentPrompt(
  input: RuntimePromptPolicyInput,
  workflow: RuntimeWorkflowSpec,
  prompt: string,
  agentDefinitionName: string,
): string {
  if (input.runtimeId === "antigravity") {
    const agentReference = `Use Antigravity native subagents for this workflow.\nDispatch the custom agent "${agentDefinitionName}" or invoke subagents via invoke_subagent with Workspace: "branch" to coordinate this workflow.`;
    const workflowSpecificGuidance = getAntigravityNativeSubagentWorkflowGuidance(
      workflow.workflowKind,
    );

    return [
      "Use Antigravity native subagents for this workflow.",
      agentReference,
      "Wait for delegated work to complete before producing the final answer.",
      "Do not use slash or skill commands as the primary execution mechanism when native subagents are available.",
      workflowSpecificGuidance,
      "",
      prompt,
    ].join("\n");
  }

  const agentReference = `Spawn the custom Codex agent "${agentDefinitionName}" and delegate this workflow to it.`;
  const workflowSpecificGuidance = getNativeSubagentWorkflowGuidance(workflow.workflowKind);

  return [
    "Use Codex native subagents for this workflow.",
    agentReference,
    "Wait for delegated work to complete before producing the final answer.",
    "Do not use slash or skill commands as the primary execution mechanism when native subagents are available.",
    workflowSpecificGuidance,
    "",
    prompt,
  ].join("\n");
}

export function resolveRuntimePromptPolicy(
  input: RuntimePromptPolicyInput,
): RuntimePromptPolicyResult {
  const canUseAgentDefinition = Boolean(
    input.workflow.agentDefinitionName && input.capabilities.supportsAgentDefinitions,
  );
  const wantsNativeSubagentWorkflow = input.workflow.executionMode === "native_subagents";
  const wantsIsolatedSkillCommand = input.workflow.executionMode === "isolated_skill_session";
  const wantsSlashFallback = input.workflow.fallbackStrategy === "slash_command";

  const isCodex = input.runtimeId === "codex";
  const isAntigravity = input.runtimeId === "antigravity";

  const codexSubagentStrategy = resolveCodexSubagentStrategy(
    input.runtimeId,
    input.runtimeOptions,
    { nativeSubagentsEnabled: input.codexNativeSubagentsEnabled === true },
  );
  const codexNativeReadiness = isCodex
    ? resolveCodexNativeSubagentReadiness(input.projectRoot)
    : null;

  const antigravitySubagentStrategy = resolveAntigravitySubagentStrategy(
    input.runtimeId,
    input.runtimeOptions,
    { nativeSubagentsEnabled: input.antigravityNativeSubagentsEnabled !== false },
  );
  const antigravityNativeReadiness = isAntigravity
    ? resolveAntigravityNativeSubagentReadiness(input.projectRoot)
    : null;

  const supportsIsolatedSkillCommand = Boolean(
    input.capabilities.supportsIsolatedSubagentWorkflows,
  );
  const supportsNativeSubagentWorkflow =
    Boolean(input.capabilities.supportsNativeSubagentWorkflows) &&
    (isCodex
      ? codexSubagentStrategy.strategy === CODEX_SUBAGENT_STRATEGIES.native &&
        codexNativeReadiness?.ready === true
      : isAntigravity
        ? antigravitySubagentStrategy.strategy === ANTIGRAVITY_SUBAGENT_STRATEGIES.native &&
          antigravityNativeReadiness?.ready === true
        : false);
  const hasFallbackCommand = Boolean(input.workflow.promptInput.fallbackSlashCommand?.trim());
  const hasNativeAgentName = Boolean(input.workflow.agentDefinitionName?.trim());
  const useNativeSubagentWorkflow =
    !canUseAgentDefinition &&
    wantsNativeSubagentWorkflow &&
    supportsNativeSubagentWorkflow &&
    hasNativeAgentName;
  const useIsolatedSkillCommand =
    !canUseAgentDefinition &&
    (wantsIsolatedSkillCommand ||
      (wantsNativeSubagentWorkflow && !useNativeSubagentWorkflow && wantsSlashFallback)) &&
    supportsIsolatedSkillCommand &&
    hasFallbackCommand;
  const useSlashFallback =
    !canUseAgentDefinition &&
    wantsSlashFallback &&
    hasFallbackCommand &&
    !useNativeSubagentWorkflow &&
    !useIsolatedSkillCommand;

  if (!canUseAgentDefinition && input.workflow.agentDefinitionName) {
    input.logger?.debug?.(
      {
        runtimeId: input.runtimeId,
        workflowKind: input.workflow.workflowKind,
        agentDefinitionName: input.workflow.agentDefinitionName,
        hasFallbackCommand,
      },
      "Runtime does not support agent definitions, checking workflow fallback strategy",
    );
  }
  if (wantsNativeSubagentWorkflow && !hasNativeAgentName) {
    input.logger?.warn?.(
      {
        runtimeId: input.runtimeId,
        workflowKind: input.workflow.workflowKind,
      },
      "Workflow requested native subagent execution but no agentDefinitionName was provided",
    );
  }
  if (codexSubagentStrategy.reason === "invalid_fallback") {
    input.logger?.warn?.(
      {
        runtimeId: input.runtimeId,
        workflowKind: input.workflow.workflowKind,
        invalidValue: codexSubagentStrategy.configuredValue,
      },
      "Ignoring invalid Codex subagent strategy override; falling back to isolated skill-session execution",
    );
  }
  if (
    wantsNativeSubagentWorkflow &&
    codexSubagentStrategy.reason === "explicit_isolated" &&
    input.runtimeId === "codex"
  ) {
    input.logger?.warn?.(
      {
        runtimeId: input.runtimeId,
        workflowKind: input.workflow.workflowKind,
      },
      "Native Codex subagents disabled via runtime option; falling back to isolated skill-session execution",
    );
  }
  if (
    wantsNativeSubagentWorkflow &&
    codexSubagentStrategy.reason === "disabled_by_env" &&
    input.runtimeId === "codex"
  ) {
    input.logger?.warn?.(
      {
        runtimeId: input.runtimeId,
        workflowKind: input.workflow.workflowKind,
        featureFlag: "AIF_RUNTIME_CODEX_NATIVE_SUBAGENTS_ENABLED",
      },
      "Native Codex subagents disabled by feature flag; falling back to isolated skill-session execution",
    );
  }
  if (
    wantsNativeSubagentWorkflow &&
    input.runtimeId === "codex" &&
    codexSubagentStrategy.strategy === CODEX_SUBAGENT_STRATEGIES.native &&
    codexNativeReadiness &&
    !codexNativeReadiness.ready
  ) {
    input.logger?.warn?.(
      {
        runtimeId: input.runtimeId,
        workflowKind: input.workflow.workflowKind,
        missingPaths: codexNativeReadiness.missingPaths,
      },
      "Native Codex subagents requested but project is missing required AI Factory-managed .codex assets; falling back to isolated skill-session execution",
    );
  }

  if (antigravitySubagentStrategy.reason === "invalid_fallback") {
    input.logger?.warn?.(
      {
        runtimeId: input.runtimeId,
        workflowKind: input.workflow.workflowKind,
        invalidValue: antigravitySubagentStrategy.configuredValue,
      },
      "Ignoring invalid Antigravity subagent strategy override; falling back to slash-command execution",
    );
  }
  if (
    wantsNativeSubagentWorkflow &&
    antigravitySubagentStrategy.reason === "explicit_isolated" &&
    input.runtimeId === "antigravity"
  ) {
    input.logger?.warn?.(
      {
        runtimeId: input.runtimeId,
        workflowKind: input.workflow.workflowKind,
      },
      "Native Antigravity subagents disabled via runtime option; falling back to slash-command execution",
    );
  }
  if (
    wantsNativeSubagentWorkflow &&
    antigravitySubagentStrategy.reason === "disabled_by_env" &&
    input.runtimeId === "antigravity"
  ) {
    input.logger?.warn?.(
      {
        runtimeId: input.runtimeId,
        workflowKind: input.workflow.workflowKind,
      },
      "Native Antigravity subagents disabled; falling back to slash-command execution",
    );
  }
  if (
    wantsNativeSubagentWorkflow &&
    input.runtimeId === "antigravity" &&
    antigravitySubagentStrategy.strategy === ANTIGRAVITY_SUBAGENT_STRATEGIES.native &&
    antigravityNativeReadiness &&
    !antigravityNativeReadiness.ready
  ) {
    input.logger?.warn?.(
      {
        runtimeId: input.runtimeId,
        workflowKind: input.workflow.workflowKind,
        missingPaths: antigravityNativeReadiness.missingPaths,
      },
      "Native Antigravity subagents requested but project is missing required AI Factory-managed .agents/agents assets; falling back to slash-command execution",
    );
  }

  if (wantsSlashFallback && !hasFallbackCommand) {
    input.logger?.warn?.(
      {
        runtimeId: input.runtimeId,
        workflowKind: input.workflow.workflowKind,
      },
      "Workflow requested slash fallback but no fallback slash command was provided",
    );
  }
  if (
    wantsNativeSubagentWorkflow &&
    !supportsNativeSubagentWorkflow &&
    !(
      input.runtimeId === "codex" &&
      codexSubagentStrategy.strategy === CODEX_SUBAGENT_STRATEGIES.native &&
      codexNativeReadiness &&
      !codexNativeReadiness.ready
    ) &&
    !(
      input.runtimeId === "antigravity" &&
      antigravitySubagentStrategy.strategy === ANTIGRAVITY_SUBAGENT_STRATEGIES.native &&
      antigravityNativeReadiness &&
      !antigravityNativeReadiness.ready
    ) &&
    codexSubagentStrategy.reason !== "invalid_fallback" &&
    codexSubagentStrategy.reason !== "disabled_by_env" &&
    antigravitySubagentStrategy.reason !== "invalid_fallback" &&
    antigravitySubagentStrategy.reason !== "disabled_by_env" &&
    antigravitySubagentStrategy.reason !== "explicit_isolated"
  ) {
    input.logger?.warn?.(
      {
        runtimeId: input.runtimeId,
        workflowKind: input.workflow.workflowKind,
      },
      "Workflow requested native subagent execution but runtime does not support it",
    );
  }
  if (wantsNativeSubagentWorkflow && !supportsNativeSubagentWorkflow && !hasFallbackCommand) {
    input.logger?.warn?.(
      {
        runtimeId: input.runtimeId,
        workflowKind: input.workflow.workflowKind,
      },
      "Workflow requested native subagent execution without any fallback command; prompt will remain non-delegated",
    );
  }
  if (wantsIsolatedSkillCommand && !supportsIsolatedSkillCommand) {
    input.logger?.warn?.(
      {
        runtimeId: input.runtimeId,
        workflowKind: input.workflow.workflowKind,
      },
      "Workflow requested isolated skill-command execution but runtime does not support it",
    );
  }

  const prompt = useNativeSubagentWorkflow
    ? prependNativeSubagentPrompt(
        input,
        input.workflow,
        input.workflow.promptInput.prompt,
        input.workflow.agentDefinitionName ?? "",
      )
    : useIsolatedSkillCommand
      ? prependSlashFallbackPrompt(
          input.workflow.promptInput.prompt,
          input.workflow.promptInput.fallbackSlashCommand ?? "",
        )
      : useSlashFallback
        ? prependSlashFallbackPrompt(
            input.workflow.promptInput.prompt,
            input.workflow.promptInput.fallbackSlashCommand ?? "",
          )
        : input.workflow.promptInput.prompt;
  const systemPromptAppend = input.workflow.promptInput.systemPromptAppend ?? "";
  const agentDefinitionName = canUseAgentDefinition
    ? input.workflow.agentDefinitionName
    : undefined;

  let nativeSubagentFallbackReason: string | undefined = undefined;
  if (wantsNativeSubagentWorkflow && !useNativeSubagentWorkflow) {
    if (input.runtimeId === "codex") {
      if (codexNativeReadiness && !codexNativeReadiness.ready) {
        nativeSubagentFallbackReason = "missing_native_assets";
      } else if (codexSubagentStrategy.reason !== "non_codex") {
        nativeSubagentFallbackReason = codexSubagentStrategy.reason;
      }
    } else if (input.runtimeId === "antigravity") {
      if (antigravityNativeReadiness && !antigravityNativeReadiness.ready) {
        nativeSubagentFallbackReason = "missing_native_assets";
      } else if (antigravitySubagentStrategy.reason !== "non_antigravity") {
        nativeSubagentFallbackReason = antigravitySubagentStrategy.reason;
      }
    }
  }

  input.logger?.debug?.(
    {
      runtimeId: input.runtimeId,
      workflowKind: input.workflow.workflowKind,
      usedFallbackSlashCommand: useSlashFallback,
      usedIsolatedSkillCommand: useIsolatedSkillCommand,
      usedNativeSubagentWorkflow: useNativeSubagentWorkflow,
      nativeSubagentFallbackReason: nativeSubagentFallbackReason ?? null,
      agentDefinitionName: agentDefinitionName ?? null,
      systemPromptAppendLength: systemPromptAppend.length,
    },
    "Resolved runtime workflow prompt policy",
  );

  return {
    prompt,
    systemPromptAppend,
    agentDefinitionName,
    usedFallbackSlashCommand: useSlashFallback,
    usedIsolatedSkillCommand: useIsolatedSkillCommand,
    usedNativeSubagentWorkflow: useNativeSubagentWorkflow,
    nativeSubagentFallbackReason,
  };
}
