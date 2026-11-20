import { spawn } from "node:child_process";

export interface ExecResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** The executable itself could not be started, for example it is not installed. */
  notFound: boolean;
}

export interface ExecOptions {
  cwd?: string;
  timeoutMs?: number;
  /** Run through the shell. Only for commands the repo owner wrote in config. */
  shell?: boolean;
  /** Text sent to the process on stdin. */
  input?: string;
}

export function exec(command: string, args: string[], options: ExecOptions = {}): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: options.shell ?? false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    // Always closed, with or without input, so the child never waits on stdin.
    child.stdin.end(options.input);

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));

    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, options.timeoutMs)
      : undefined;

    const finish = (exitCode: number | null, notFound: boolean) => {
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr, timedOut, notFound });
    };
    child.on("error", () => finish(null, true));
    child.on("close", (code) => finish(code, false));
  });
}

/** Keeps the end of long output, where compilers and test runners put the verdict. */
export function tail(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `[earlier output trimmed]\n${text.slice(-maxChars)}`;
}
