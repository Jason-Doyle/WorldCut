/**
 * Port discovery, one-time builds, and per-case CLI execution.
 *
 * Each non-TypeScript port is built exactly once into the temporary workspace
 * (or its conventional project output directory) and then spawned per case.
 * Executables are overridable through environment variables so a developer
 * machine can point at a private toolchain.
 */

import { execFile } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Maximum bytes captured from one CLI invocation. */
const MAX_BUFFER = 64 * 1024 * 1024;

/** Maximum time allowed for a one-time port build or readiness probe. */
const BUILD_TIMEOUT_MS = 5 * 60 * 1000;

const IS_WINDOWS = process.platform === "win32";

/**
 * @param {string} path
 * @returns {Promise<boolean>}
 */
async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, timeoutMs?: number }} [options]
 * @returns {Promise<string>}
 */
async function run(command, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? BUILD_TIMEOUT_MS;
  try {
    const { stdout } = await execFileAsync(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      maxBuffer: MAX_BUFFER,
      timeout: timeoutMs,
      killSignal: "SIGKILL",
      windowsHide: true,
    });
    return stdout.toString();
  } catch (error) {
    if (
      error !== null &&
      typeof error === "object" &&
      "killed" in error &&
      error.killed === true
    ) {
      throw new Error(
        `${command} timed out after ${timeoutMs}ms while preparing a port`,
        { cause: error },
      );
    }
    throw error;
  }
}

/**
 * Describes how one implementation is invoked.
 *
 * @typedef {object} PortRunner
 * @property {string} id
 * @property {string} label
 * @property {string} command
 * @property {string[]} baseArgs
 * @property {string} [cwd]
 * @property {NodeJS.ProcessEnv} [env]
 * @property {number} timeoutMs
 * @property {string} description
 */

/**
 * @typedef {object} PortOutcome
 * @property {number} status Process exit code.
 * @property {string} stdout
 * @property {string} stderr
 * @property {"result" | "error" | "unusable"} kind
 * @property {unknown} [result] Parsed verification result when `kind` is `result`.
 * @property {string} [code] Stable error code when `kind` is `error`.
 * @property {string} [message] Human error message when `kind` is `error`.
 * @property {string} [failure] Why the output could not be interpreted.
 */

/**
 * Builds every port once and returns their runners.
 *
 * @param {{ repoRoot: string, workspace: string, timeoutMs: number, log: (line: string) => void }} context
 * @returns {Promise<PortRunner[]>}
 */
export async function prepareRunners(context) {
  const { repoRoot, workspace, timeoutMs, log } = context;

  /** @type {PortRunner[]} */
  const runners = [];

  const nodeExecutable = process.env["WORLDCUT_NODE"] ?? process.execPath;
  const cliPath = join(repoRoot, "dist", "cli.js");
  if (!(await exists(cliPath))) {
    throw new Error(
      `${cliPath} is missing. Run "npm run build" before the differential suite.`,
    );
  }
  runners.push({
    id: "typescript",
    label: "TypeScript",
    command: nodeExecutable,
    baseArgs: [cliPath, "--full"],
    timeoutMs,
    description: `${nodeExecutable} dist/cli.js --full`,
  });

  const goExecutable = process.env["WORLDCUT_GO"] ?? "go";
  const goPortRoot = join(repoRoot, "ports", "go");
  const goBinary = join(
    workspace,
    IS_WINDOWS ? "worldcut-go.exe" : "worldcut-go",
  );
  log(`building Go CLI with ${goExecutable}`);
  await run(goExecutable, ["build", "-o", goBinary, "./cmd/worldcut-go"], {
    cwd: goPortRoot,
  });
  runners.push({
    id: "go",
    label: "Go",
    command: goBinary,
    baseArgs: [],
    timeoutMs,
    description: "ports/go/cmd/worldcut-go",
  });

  const pythonExecutable = process.env["WORLDCUT_PYTHON"] ?? "python";
  log(`checking Python port with ${pythonExecutable}`);
  await run(pythonExecutable, [
    "-c",
    "import worldcut; assert worldcut.ENGINE_VERSION",
  ]);
  runners.push({
    id: "python",
    label: "Python",
    command: pythonExecutable,
    baseArgs: ["-m", "worldcut.cli"],
    timeoutMs,
    description: `${pythonExecutable} -m worldcut.cli`,
  });

  const dotnetExecutable = process.env["WORLDCUT_DOTNET"] ?? "dotnet";
  const framework = process.env["WORLDCUT_DOTNET_FRAMEWORK"] ?? "net8.0";
  const dotnetPortRoot = join(repoRoot, "ports", "dotnet");
  const project = join("src", "WorldCut.Tool", "WorldCut.Tool.csproj");
  log(`building .NET CLI (${framework}) with ${dotnetExecutable}`);
  await run(
    dotnetExecutable,
    [
      "build",
      project,
      "--configuration",
      "Release",
      "--framework",
      framework,
      "-p:RestoreLockedMode=true",
    ],
    {
      cwd: dotnetPortRoot,
      env: {
        ...process.env,
        DOTNET_NOLOGO: "1",
        DOTNET_CLI_TELEMETRY_OPTOUT: "1",
      },
    },
  );
  const dotnetOutput = join(
    dotnetPortRoot,
    "src",
    "WorldCut.Tool",
    "bin",
    "Release",
    framework,
  );
  const assembly = join(dotnetOutput, "WorldCut.Tool.dll");
  if (!(await exists(assembly))) {
    throw new Error(`the .NET build produced no CLI under ${dotnetOutput}`);
  }
  // The built apphost resolves its runtime through DOTNET_ROOT or a
  // machine-wide install, which may not be the host that produced the build.
  // Running the assembly through the selected muxer keeps the harness on one
  // runtime no matter where the SDK lives.
  runners.push({
    id: "dotnet",
    label: ".NET",
    command: dotnetExecutable,
    baseArgs: ["exec", assembly],
    timeoutMs,
    description: `${dotnetExecutable} exec WorldCut.Tool.dll (${framework})`,
  });

  return runners;
}

/**
 * Runs one port against one input file and classifies its output.
 *
 * @param {PortRunner} runner
 * @param {string} inputPath
 * @returns {Promise<PortOutcome>}
 */
export function runPort(runner, inputPath) {
  return new Promise((resolve) => {
    execFile(
      runner.command,
      [...runner.baseArgs, inputPath],
      {
        cwd: runner.cwd,
        env: runner.env ?? process.env,
        maxBuffer: MAX_BUFFER,
        timeout: runner.timeoutMs,
        killSignal: "SIGKILL",
        windowsHide: true,
        encoding: "buffer",
      },
      (error, stdoutBuffer, stderrBuffer) => {
        const stdout = stdoutBuffer.toString("utf8");
        const stderr = stderrBuffer.toString("utf8");
        /** @type {number} */
        let status;
        if (error === null) {
          status = 0;
        } else if (typeof error.code === "number") {
          status = error.code;
        } else {
          const failure =
            error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
              ? `${runner.id} exceeded the ${MAX_BUFFER}-byte output limit`
              : error.killed
                ? `${runner.id} timed out after ${runner.timeoutMs}ms`
                : `${runner.id} could not be executed: ${error.message}`;
          resolve({
            status: -1,
            stdout,
            stderr,
            kind: "unusable",
            failure,
          });
          return;
        }
        resolve(classify(runner, status, stdout, stderr));
      },
    );
  });
}

/**
 * @param {PortRunner} runner
 * @param {number} status
 * @param {string} stdout
 * @param {string} stderr
 * @returns {PortOutcome}
 */
function classify(runner, status, stdout, stderr) {
  if (status === 0) {
    try {
      return {
        status,
        stdout,
        stderr,
        kind: "result",
        result: JSON.parse(stdout),
      };
    } catch (error) {
      return {
        status,
        stdout,
        stderr,
        kind: "unusable",
        failure: `${runner.id} exited 0 but printed unparsable JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  const envelope = parseEnvelope(stderr);
  if (envelope === null) {
    return {
      status,
      stdout,
      stderr,
      kind: "unusable",
      failure: `${runner.id} exited ${status} without a stable error envelope`,
    };
  }
  return {
    status,
    stdout,
    stderr,
    kind: "error",
    code: envelope.code,
    message: envelope.message,
  };
}

/**
 * @param {string} stderr
 * @returns {{ code: string, message: string } | null}
 */
function parseEnvelope(stderr) {
  const trimmed = stderr.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const lines = trimmed.split(/\r?\n/);
  const last = lines[lines.length - 1];
  if (last === undefined) {
    return null;
  }
  try {
    const parsed = JSON.parse(last);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "error" in parsed &&
      parsed.error !== null &&
      typeof parsed.error === "object" &&
      typeof (/** @type {{ code?: unknown }} */ (parsed.error).code) === "string"
    ) {
      const envelope = /** @type {{ code: string, message?: unknown }} */ (
        parsed.error
      );
      return {
        code: envelope.code,
        message:
          typeof envelope.message === "string" ? envelope.message : "",
      };
    }
    return null;
  } catch {
    return null;
  }
}
