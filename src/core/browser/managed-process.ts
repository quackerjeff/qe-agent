import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import http from "node:http";
import type { ManagedProcessInfo } from "./types.js";

export interface ManagedProcessOptions {
  executable: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  port: number;
  readinessUrl?: string;
  readinessTimeoutMs?: number;
  readinessIntervalMs?: number;
  maxOutputLines?: number;
}

export interface ManagedProcessResult {
  started: boolean;
  ready: boolean;
  info?: ManagedProcessInfo;
  stdout: string[];
  stderr: string[];
  error?: string;
}

export class ManagedProcess {
  private process: ChildProcess | null = null;
  private readonly stdout: string[] = [];
  private readonly stderr: string[] = [];
  private readonly maxOutputLines: number;
  private _port: number;
  private _started = false;
  private _ready = false;
  private _pgid: number | undefined;

  constructor(private readonly options: ManagedProcessOptions) {
    this.maxOutputLines = options.maxOutputLines ?? 200;
    this._port = options.port;
  }

  get port(): number {
    return this._port;
  }

  get pid(): number | undefined {
    return this.process?.pid;
  }

  get started(): boolean {
    return this._started;
  }

  get ready(): boolean {
    return this._ready;
  }

  async start(): Promise<ManagedProcessResult> {
    try {
      const env = {
        ...process.env,
        ...this.options.env,
        PORT: String(this._port),
      };

      // Correction 6: use detached=true to create a process group
      this.process = spawn(this.options.executable, this.options.args, {
        cwd: this.options.cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      });

      if (!this.process.pid) {
        return {
          started: false,
          ready: false,
          stdout: [],
          stderr: [],
          error: "Failed to spawn process",
        };
      }

      this._started = true;
      this._pgid = this.process.pid;

      // Prevent the detached child from keeping the parent alive
      this.process.unref();

      if (this.process.stdout) {
        const rl = createInterface({ input: this.process.stdout });
        rl.on("line", (line) => {
          if (this.stdout.length < this.maxOutputLines) {
            this.stdout.push(line);
          }
        });
      }

      if (this.process.stderr) {
        const rl = createInterface({ input: this.process.stderr });
        rl.on("line", (line) => {
          if (this.stderr.length < this.maxOutputLines) {
            this.stderr.push(line);
          }
        });
      }

      let exited = false;
      const exitPromise = new Promise<number | null>((resolve) => {
        this.process!.on("exit", (code) => {
          exited = true;
          resolve(code);
        });
        this.process!.on("error", () => {
          exited = true;
          resolve(null);
        });
      });

      const readinessTimeout = this.options.readinessTimeoutMs ?? 15_000;
      const readinessInterval = this.options.readinessIntervalMs ?? 500;
      const readinessUrl =
        this.options.readinessUrl ?? `http://127.0.0.1:${this._port}/`;

      const ready = await this.waitForReady(
        readinessUrl,
        readinessTimeout,
        readinessInterval,
        () => exited,
      );

      if (!ready && exited) {
        const exitCode = await exitPromise;
        return {
          started: true,
          ready: false,
          stdout: [...this.stdout],
          stderr: [...this.stderr],
          error: `Process exited before ready with code ${exitCode}`,
        };
      }

      this._ready = ready;

      return {
        started: true,
        ready,
        info: ready
          ? {
              pid: this.process.pid!,
              command: `${this.options.executable} ${this.options.args.join(" ")}`,
              port: this._port,
              startedAt: new Date().toISOString(),
            }
          : undefined,
        stdout: [...this.stdout],
        stderr: [...this.stderr],
        error: ready ? undefined : "Readiness timeout",
      };
    } catch (err) {
      return {
        started: false,
        ready: false,
        stdout: [...this.stdout],
        stderr: [...this.stderr],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async stop(): Promise<void> {
    if (!this._pgid && (!this.process || !this.process.pid)) return;

    const proc = this.process;
    const pgid = this._pgid;
    this.process = null;
    this._pgid = undefined;

    // Correction 6: SIGTERM the entire process group, not just the leader
    if (pgid) {
      try {
        process.kill(-pgid, "SIGTERM");
      } catch {
        // process group already dead
      }
    } else if (proc) {
      try {
        proc.kill("SIGTERM");
      } catch {
        // already dead
      }
    }

    const exited = await Promise.race([
      new Promise<boolean>((resolve) => {
        if (proc) {
          proc.on("exit", () => resolve(true));
          proc.on("error", () => resolve(true));
        } else {
          resolve(true);
        }
      }),
      new Promise<boolean>((resolve) =>
        setTimeout(() => resolve(false), 5_000),
      ),
    ]);

    if (!exited && pgid) {
      try {
        process.kill(-pgid, "SIGKILL");
      } catch {
        // already dead
      }
      await new Promise<void>((resolve) => {
        if (proc) {
          proc.on("exit", () => resolve());
        }
        setTimeout(resolve, 2_000);
      });
    } else if (!exited && proc) {
      try {
        proc.kill("SIGKILL");
      } catch {
        // already dead
      }
      await new Promise<void>((resolve) => {
        proc.on("exit", () => resolve());
        setTimeout(resolve, 2_000);
      });
    }

    this._started = false;
    this._ready = false;
  }

  isPortFree(): Promise<boolean> {
    return new Promise((resolve) => {
      const server = http.createServer();
      server.once("error", () => resolve(false));
      server.once("listening", () => {
        server.close(() => resolve(true));
      });
      server.listen(this._port, "127.0.0.1");
    });
  }

  private waitForReady(
    url: string,
    timeoutMs: number,
    intervalMs: number,
    hasExited: () => boolean,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const deadline = Date.now() + timeoutMs;

      const check = () => {
        if (Date.now() >= deadline || hasExited()) {
          resolve(false);
          return;
        }

        const req = http.get(url, (res) => {
          res.resume();
          if (res.statusCode && res.statusCode < 500) {
            resolve(true);
          } else {
            setTimeout(check, intervalMs);
          }
        });
        req.on("error", () => {
          setTimeout(check, intervalMs);
        });
        req.setTimeout(2_000, () => {
          req.destroy();
          setTimeout(check, intervalMs);
        });
      };

      check();
    });
  }
}
