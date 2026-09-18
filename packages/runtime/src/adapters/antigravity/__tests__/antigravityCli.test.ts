import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeEvent, RuntimeRunInput } from "../../../types.js";
import { TEST_USAGE_CONTEXT } from "../../../__tests__/helpers/usageContext.js";

const { mockStdout, mockStderr, _mockStdin, mockChild } = vi.hoisted(() => {
  const stdout = { on: vi.fn() };
  const stderr = { on: vi.fn() };
  const stdin = { on: vi.fn(), write: vi.fn(), end: vi.fn() };
  return {
    mockStdout: stdout,
    mockStderr: stderr,
    _mockStdin: stdin,
    mockChild: {
      pid: 1234,
      stdout,
      stderr,
      stdin,
      on: vi.fn(),
      kill: vi.fn(),
    },
  };
});

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: vi.fn().mockReturnValue(mockChild),
    exec: vi.fn(),
  };
});

const { runAntigravityCli } = await import("../cli.js");

function createInput(overrides: Partial<RuntimeRunInput> = {}): RuntimeRunInput {
  return {
    runtimeId: "antigravity",
    providerId: "google",
    prompt: "Test prompt",
    options: {},
    projectRoot: "d:\\test-project",
    cwd: "d:\\test-project",
    usageContext: TEST_USAGE_CONTEXT,
    ...overrides,
  };
}

function simulateStreamAndClose(code: number, jsonlLines: unknown[] = [], stderr = "") {
  const stdoutHandler = mockStdout.on.mock.calls.find((c: unknown[]) => c[0] === "data")?.[1] as
    | ((chunk: string) => void)
    | undefined;
  for (const line of jsonlLines) {
    const text = typeof line === "string" ? line : JSON.stringify(line);
    stdoutHandler?.(text + "\n");
  }

  if (stderr) {
    const stderrHandler = mockStderr.on.mock.calls.find((c: unknown[]) => c[0] === "data")?.[1] as
      | ((chunk: string) => void)
      | undefined;
    stderrHandler?.(stderr);
  }

  const closeHandler = mockChild.on.mock.calls.find((c: unknown[]) => c[0] === "close")?.[1] as
    | ((code: number) => void)
    | undefined;
  closeHandler?.(code);
}

describe("Antigravity CLI Runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("streams text deltas, tool:use on ACTIVE, and tool:result on DONE", async () => {
    const onEvent = vi.fn();
    const onToolUse = vi.fn();
    const input = createInput({
      execution: {
        onEvent,
        onToolUse,
      },
    });

    const runPromise = runAntigravityCli(input, undefined, {
      pathToAntigravityExecutable: "C:\\Users\\wait\\AppData\\Local\\agy\\bin\\agy.exe",
    });

    simulateStreamAndClose(0, [
      {
        event: "init",
        conversation_id: "conv-1234",
        init: { model: "gemini-3.8-flash-low", cwd: "d:\\test-project" },
      },
      {
        event: "step_update",
        step_update: {
          conversation_id: "conv-1234",
          step_index: 0,
          state: "DONE",
          step_type: "user_input",
        },
      },
      {
        event: "step_update",
        step_update: {
          conversation_id: "conv-1234",
          step_index: 1,
          state: "ACTIVE",
          step_type: "tool",
          tool_name: "run_command",
          tool_info: {
            name: "run_command",
            parameters: { CommandLine: "echo hello" },
          },
        },
      },
      {
        event: "step_update",
        step_update: {
          conversation_id: "conv-1234",
          step_index: 1,
          state: "DONE",
          step_type: "tool",
          tool_name: "run_command",
          duration_seconds: 0.25,
          tool_info: {
            name: "run_command",
            parameters: { CommandLine: "echo hello" },
            output: "hello\n",
          },
        },
      },
      {
        event: "step_update",
        step_update: {
          conversation_id: "conv-1234",
          step_index: 2,
          state: "DONE",
          step_type: "agent_response",
          text_delta: "The command printed: hello\n",
          usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
        },
      },
      {
        event: "result",
        result: {
          conversation_id: "conv-1234",
          status: "SUCCESS",
          response: "The command printed: hello\n",
          usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
        },
      },
    ]);

    const result = await runPromise;

    expect(result.outputText).toBe("The command printed: hello");
    expect(result.sessionId).toBe("conv-1234");
    expect(result.usage).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
    });

    // onToolUse was called exactly once on ACTIVE invocation
    expect(onToolUse).toHaveBeenCalledTimes(1);
    expect(onToolUse).toHaveBeenCalledWith("run_command", expect.stringContaining("echo hello"));

    const emittedEvents: RuntimeEvent[] = onEvent.mock.calls.map((c) => c[0]);

    // tool:use was emitted once
    const toolUseEvents = emittedEvents.filter((e) => e.type === "tool:use");
    expect(toolUseEvents).toHaveLength(1);
    expect(toolUseEvents[0].data?.name).toBe("run_command");

    // tool:result was emitted once on completion
    const toolResultEvents = emittedEvents.filter((e) => e.type === "tool:result");
    expect(toolResultEvents).toHaveLength(1);
    expect(toolResultEvents[0].data?.name).toBe("run_command");
    expect(toolResultEvents[0].data?.output).toBe("hello\n");

    // stream:text was emitted
    const textEvents = emittedEvents.filter((e) => e.type === "stream:text");
    expect(textEvents).toHaveLength(1);
    expect(textEvents[0].message).toBe("The command printed: hello\n");
  });
});
