import { spawn, exec } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import type { RuntimeEvent, RuntimeRunInput, RuntimeRunResult, RuntimeUsage } from "../../types.js";
import {
  makeProcessRunTimeoutError,
  makeProcessStartTimeoutError,
  resolveRetryDelay,
  sleepMs,
  withProcessTimeouts,
} from "../../timeouts.js";
import { classifyAntigravityRuntimeError } from "./errors.js";
import { findAntigravityPath } from "./findPath.js";
import { buildToolUseEvents } from "../../toolEvents.js";
import { DEFAULT_ANTIGRAVITY_MODEL } from "./models.js";
import { PROXY_ENV_VARS } from "../../proxyEnv.js";

const IS_WINDOWS = process.platform === "win32";

export interface AntigravityCliLogger {
  debug?(context: Record<string, unknown>, message: string): void;
  info?(context: Record<string, unknown>, message: string): void;
  warn?(context: Record<string, unknown>, message: string): void;
  error?(context: Record<string, unknown>, message: string): void;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

const ALLOWED_ENV_PREFIXES = [
  "ANTIGRAVITY_",
  "GEMINI_",
  "GOOGLE_",
  "AIF_",
  "HANDOFF_",
  "NODE_",
  "npm_",
  "HOME",
  "USER",
  "LANG",
  "LC_",
  "PATH",
  "SHELL",
  "TERM",
  "TMPDIR",
  "TZ",
  "LOCALAPPDATA",
  "APPDATA",
  "USERPROFILE",
  "SYSTEMROOT",
  "COMSPEC",
  "PATHEXT",
  ...PROXY_ENV_VARS,
];

function buildCuratedEnv(executionEnv?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value == null) continue;
    if (ALLOWED_ENV_PREFIXES.some((prefix) => key === prefix || key.startsWith(prefix))) {
      env[key] = value;
    }
  }
  Object.assign(env, executionEnv ?? {});
  return env;
}

function resolveCliPath(input: RuntimeRunInput, adapterDefault?: string): string {
  const options = asRecord(input.options);
  return (
    readString(options.antigravityCliPath) ??
    readString(process.env.ANTIGRAVITY_BIN_PATH) ??
    adapterDefault ??
    findAntigravityPath() ??
    "agy.exe"
  );
}

function resolveTimeoutMs(input: RuntimeRunInput): number {
  return input.execution?.runTimeoutMs ?? 1_800_000; // 30m default
}

function killProcessTree(pid: number): void {
  if (IS_WINDOWS) {
    try {
      exec(`taskkill /PID ${pid} /T /F`, () => {});
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

interface StreamState {
  sessionId: string | null;
  outputText: string;
  usage: RuntimeUsage | null;
  events: RuntimeEvent[];
  plainTextFallback: string;
}

function createStreamState(fallbackSessionId: string | null): StreamState {
  return {
    sessionId: fallbackSessionId,
    outputText: "",
    usage: null,
    events: [],
    plainTextFallback: "",
  };
}

function emitEvent(
  state: StreamState,
  execution: RuntimeRunInput["execution"],
  event: RuntimeEvent,
): void {
  state.events.push(event);
  execution?.onEvent?.(event);
}

function summarizeToolInput(input: unknown): string {
  if (input == null) return "";
  if (typeof input === "string") {
    return input.length > 80 ? `${input.slice(0, 77)}...` : input;
  }
  try {
    const json = JSON.stringify(input);
    if (json.length <= 100) return json;
    return `${json.slice(0, 97)}...`;
  } catch {
    return "";
  }
}

function processStreamJsonLine(
  line: string,
  state: StreamState,
  input: RuntimeRunInput,
  logger?: AntigravityCliLogger,
): void {
  const execution = input.execution;
  const trimmed = line.trim();
  if (!trimmed) return;

  let message: Record<string, unknown>;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object") {
      state.plainTextFallback += (state.plainTextFallback ? "\n" : "") + trimmed;
      return;
    }
    message = parsed as Record<string, unknown>;
  } catch {
    state.plainTextFallback += (state.plainTextFallback ? "\n" : "") + trimmed;
    return;
  }

  const nowIso = new Date().toISOString();

  // Event 1: init
  if (message.event === "init") {
    if (typeof message.conversation_id === "string" && message.conversation_id.length > 0) {
      state.sessionId = message.conversation_id;
    }
    const initData = asRecord(message.init);
    emitEvent(state, execution, {
      type: "system:init",
      timestamp: nowIso,
      level: "debug",
      message: "Antigravity session initialized",
      data: { sessionId: state.sessionId, model: initData.model },
    });
    return;
  }

  // Event 2: step_update
  if (message.event === "step_update") {
    const su = asRecord(message.step_update);
    if (su.step_type === "agent_response" && typeof su.text_delta === "string") {
      state.outputText += su.text_delta;
      emitEvent(state, execution, {
        type: "stream:text",
        timestamp: nowIso,
        level: "debug",
        message: su.text_delta,
        data: { text: su.text_delta },
      });
    }

    // Check tool calls
    if (
      su.step_type === "tool" ||
      su.step_type === "tool_call" ||
      su.tool_calls ||
      su.tool_name ||
      su.tool_info
    ) {
      const toolInfo = asRecord(su.tool_info);
      const toolCalls = Array.isArray(su.tool_calls)
        ? (su.tool_calls as Array<Record<string, unknown>>)
        : su.tool_name || toolInfo.name
          ? [
              {
                name: su.tool_name ?? toolInfo.name,
                id:
                  su.tool_id ??
                  su.call_id ??
                  (su.step_index != null ? `step-${su.step_index}` : null),
                input: toolInfo.parameters ?? su.tool_input ?? su.arguments,
              },
            ]
          : [];

      for (const tc of toolCalls) {
        const toolName = String(tc.name ?? tc.tool_name ?? "unknown_tool");
        const toolUseId = typeof tc.id === "string" ? tc.id : null;
        const toolInput = tc.input ?? tc.arguments;
        const summary = summarizeToolInput(toolInput);
        const detailSuffix = summary ? ` ${summary}` : "";
        for (const ev of buildToolUseEvents({
          toolName,
          toolUseId,
          input: toolInput,
          timestamp: nowIso,
          detailSuffix,
        })) {
          emitEvent(state, execution, ev);
        }
        execution?.onToolUse?.(toolName, detailSuffix);
      }
    }

    if (su.usage) {
      const u = asRecord(su.usage);
      const inTokens = Number(u.input_tokens) || 0;
      const outTokens = Number(u.output_tokens) || 0;
      const totalTokens = Number(u.total_tokens) || inTokens + outTokens;
      state.usage = {
        inputTokens: inTokens,
        outputTokens: outTokens,
        totalTokens,
      };
    }
    return;
  }

  // Event 3: result
  if (message.event === "result") {
    const res = asRecord(message.result);
    if (typeof res.response === "string" && !state.outputText) {
      state.outputText = res.response;
    }
    if (res.usage) {
      const u = asRecord(res.usage);
      const inTokens = Number(u.input_tokens) || 0;
      const outTokens = Number(u.output_tokens) || 0;
      const totalTokens = Number(u.total_tokens) || inTokens + outTokens;
      state.usage = {
        inputTokens: inTokens,
        outputTokens: outTokens,
        totalTokens,
      };
    }
    return;
  }
}

function buildCliArgs(input: RuntimeRunInput, tempLogFile: string, runId: string): string[] {
  const options = asRecord(input.options);
  const execution = input.execution;

  const model = input.model || DEFAULT_ANTIGRAVITY_MODEL;
  const timeoutMs = resolveTimeoutMs(input);
  const printTimeoutMinutes = Math.max(5, Math.ceil(timeoutMs / 60_000));

  const args: string[] = [
    "-p",
    input.prompt,
    "--model",
    model,
    "--output-format",
    "stream-json",
    "--print-timeout",
    `${printTimeoutMinutes}m`,
    "--log-file",
    tempLogFile,
    "--project",
    `handoff-${runId}`,
    "--mode",
    "accept-edits",
  ];

  if (execution?.bypassPermissions !== false) {
    args.push("--dangerously-skip-permissions");
  }

  const effort = options.effort;
  if (effort) {
    args.push("--effort", String(effort));
  }

  const sessionId = input.sessionId;
  if (
    sessionId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)
  ) {
    args.push("--conversation", sessionId);
  }

  return args;
}

interface CliAttemptResult {
  result: RuntimeRunResult;
  startTimedOut: boolean;
}

async function runCliAttempt(
  input: RuntimeRunInput,
  cliPath: string,
  env: Record<string, string>,
  logger?: AntigravityCliLogger,
): Promise<CliAttemptResult> {
  const execution = input.execution;
  const runId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const tempLogFile = path.join(os.tmpdir(), `agy-${runId}.log`);
  const args = buildCliArgs(input, tempLogFile, runId);

  const child = spawn(cliPath, args, {
    cwd: input.cwd,
    shell: false,
    windowsHide: true,
    env,
  });

  const timeouts = withProcessTimeouts(child, {
    startTimeoutMs: execution?.startTimeoutMs,
    runTimeoutMs: execution?.runTimeoutMs ?? resolveTimeoutMs(input),
  });

  const state = createStreamState(input.sessionId ?? null);
  let stdoutBuffer = "";
  let stderr = "";
  let streamProcessingError: unknown = null;

  // Immediate start event to satisfy orchestrator activity watchdog
  emitEvent(state, execution, {
    type: "system:init",
    timestamp: new Date().toISOString(),
    level: "debug",
    message: "Antigravity process spawned",
    data: { pid: child.pid },
  });

  const flushCompleteLines = (): void => {
    let newlineIdx = stdoutBuffer.indexOf("\n");
    while (newlineIdx !== -1) {
      const line = stdoutBuffer.slice(0, newlineIdx);
      stdoutBuffer = stdoutBuffer.slice(newlineIdx + 1);
      processStreamJsonLine(line, state, input, logger);
      newlineIdx = stdoutBuffer.indexOf("\n");
    }
  };

  child.stdout!.on("data", (chunk: Buffer | string) => {
    stdoutBuffer += String(chunk);
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
    const text = String(chunk);
    stderr += text;
    execution?.onStderr?.(text);
  });

  // Close stdin so child process does not wait on interactive console input
  child.stdin!.on("error", () => {
    /* ignore broken-pipe */
  });
  child.stdin!.end();

  // Abort handling
  if (execution?.abortController) {
    execution.abortController.signal.addEventListener(
      "abort",
      () => {
        if (child.pid) killProcessTree(child.pid);
        else child.kill("SIGTERM");
      },
      { once: true },
    );
  }

  return new Promise((resolve, reject) => {
    child.on("error", (error) => {
      timeouts.cleanup();
      fs.unlink(tempLogFile, () => {});
      reject(classifyAntigravityRuntimeError(error));
    });

    child.on("close", async (code) => {
      timeouts.cleanup();
      fs.unlink(tempLogFile, () => {});

      if (stdoutBuffer.length > 0) {
        try {
          processStreamJsonLine(stdoutBuffer, state, input, logger);
        } catch {
          /* ignore tail errors */
        }
        stdoutBuffer = "";
      }

      const startTimedOut = await timeouts.startTimedOut;

      if (streamProcessingError) {
        reject(classifyAntigravityRuntimeError(streamProcessingError));
        return;
      }

      if (startTimedOut) {
        const startMs = execution?.startTimeoutMs ?? 0;
        logger?.warn?.(
          { runtimeId: input.runtimeId, startTimeoutMs: startMs },
          "Antigravity CLI start timeout — process produced no output",
        );
        resolve({ result: null as unknown as RuntimeRunResult, startTimedOut: true });
        return;
      }

      if (timeouts.runTimedOut) {
        const runMs = execution?.runTimeoutMs ?? resolveTimeoutMs(input);
        reject(makeProcessRunTimeoutError(runMs));
        return;
      }

      if (code !== 0) {
        const message = `Antigravity CLI exited with code ${code}: ${stderr || state.outputText || state.plainTextFallback || "unknown error"}`;
        reject(classifyAntigravityRuntimeError(message));
        return;
      }

      const finalOutput =
        state.outputText.trim() ||
        state.plainTextFallback.trim() ||
        "Antigravity completed execution.";

      resolve({
        result: {
          outputText: finalOutput,
          sessionId: state.sessionId,
          usage: state.usage,
          events: state.events,
        },
        startTimedOut: false,
      });
    });
  });
}

export async function runAntigravityCli(
  input: RuntimeRunInput,
  logger?: AntigravityCliLogger,
  adapterDefaults?: { pathToAntigravityExecutable?: string },
): Promise<RuntimeRunResult> {
  const cliPath = resolveCliPath(input, adapterDefaults?.pathToAntigravityExecutable);
  const execution = input.execution;
  const env = buildCuratedEnv(execution?.environment);

  logger?.info?.(
    {
      runtimeId: input.runtimeId,
      transport: "cli",
      cliPath,
      model: input.model ?? DEFAULT_ANTIGRAVITY_MODEL,
      startTimeoutMs: execution?.startTimeoutMs ?? null,
      runTimeoutMs: execution?.runTimeoutMs ?? resolveTimeoutMs(input),
    },
    "Starting Antigravity CLI run",
  );

  const { result, startTimedOut } = await runCliAttempt(input, cliPath, env, logger);

  if (startTimedOut) {
    const retryDelayMs = resolveRetryDelay(execution ?? {});
    logger?.warn?.(
      { runtimeId: input.runtimeId, retryDelayMs },
      "Antigravity CLI start timeout, retrying once after delay",
    );
    await sleepMs(retryDelayMs);

    const retry = await runCliAttempt(input, cliPath, env, logger);
    if (retry.startTimedOut) {
      throw makeProcessStartTimeoutError(execution?.startTimeoutMs ?? 0);
    }
    return retry.result;
  }

  return result;
}
