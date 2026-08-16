import { createExecutionId } from "./execution-id.js";

export type LogLevel = "ERROR" | "WARN" | "INFO" | "DEBUG" | "TRACE";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
  TRACE: 4,
};

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  component?: string;
  executionId?: string;
  data?: Record<string, unknown>;
}

export interface Logger {
  error(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  debug(message: string, data?: Record<string, unknown>): void;
  trace(message: string, data?: Record<string, unknown>): void;
  child(component: string): Logger;
  withExecutionId(executionId: string): Logger;
}

export interface LogSink {
  write(entry: LogEntry): void;
}

export class ConsoleLogSink implements LogSink {
  write(entry: LogEntry): void {
    const parts = [entry.timestamp, `[${entry.level}]`];
    if (entry.executionId) {
      parts.push(`[${entry.executionId.slice(0, 8)}]`);
    }
    if (entry.component) {
      parts.push(`[${entry.component}]`);
    }
    parts.push(entry.message);

    const line = parts.join(" ");

    if (entry.level === "ERROR") {
      process.stderr.write(line + "\n");
    } else {
      process.stdout.write(line + "\n");
    }

    if (entry.data && Object.keys(entry.data).length > 0) {
      const dataStr = JSON.stringify(entry.data, null, 2);
      const output = entry.level === "ERROR" ? process.stderr : process.stdout;
      output.write(dataStr + "\n");
    }
  }
}

export class StructuredLogger implements Logger {
  constructor(
    private readonly sink: LogSink,
    private readonly minLevel: LogLevel,
    private readonly component?: string,
    private readonly executionId?: string,
  ) {}

  error(message: string, data?: Record<string, unknown>): void {
    this.log("ERROR", message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log("WARN", message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log("INFO", message, data);
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log("DEBUG", message, data);
  }

  trace(message: string, data?: Record<string, unknown>): void {
    this.log("TRACE", message, data);
  }

  child(component: string): Logger {
    const fullComponent = this.component
      ? `${this.component}.${component}`
      : component;
    return new StructuredLogger(
      this.sink,
      this.minLevel,
      fullComponent,
      this.executionId,
    );
  }

  withExecutionId(executionId: string): Logger {
    return new StructuredLogger(
      this.sink,
      this.minLevel,
      this.component,
      executionId,
    );
  }

  private log(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    if (LOG_LEVEL_PRIORITY[level] > LOG_LEVEL_PRIORITY[this.minLevel]) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      component: this.component,
      executionId: this.executionId,
      data,
    };

    this.sink.write(entry);
  }
}

export function createLogger(level: LogLevel = "INFO", sink?: LogSink): Logger {
  return new StructuredLogger(sink ?? new ConsoleLogSink(), level);
}

export function createSessionLogger(level: LogLevel = "INFO"): Logger {
  const executionId = createExecutionId();
  return new StructuredLogger(
    new ConsoleLogSink(),
    level,
    undefined,
    executionId,
  );
}
