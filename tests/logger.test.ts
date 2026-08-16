import { describe, it, expect } from "vitest";
import type { LogEntry, LogSink } from "../src/logging/index.js";
import { StructuredLogger } from "../src/logging/index.js";

class CaptureSink implements LogSink {
  public entries: LogEntry[] = [];
  write(entry: LogEntry): void {
    this.entries.push(entry);
  }
}

describe("StructuredLogger", () => {
  it("logs at the configured level and above", () => {
    const sink = new CaptureSink();
    const logger = new StructuredLogger(sink, "WARN");

    logger.error("error msg");
    logger.warn("warn msg");
    logger.info("info msg");
    logger.debug("debug msg");

    expect(sink.entries).toHaveLength(2);
    expect(sink.entries[0].level).toBe("ERROR");
    expect(sink.entries[1].level).toBe("WARN");
  });

  it("includes timestamp in entries", () => {
    const sink = new CaptureSink();
    const logger = new StructuredLogger(sink, "INFO");

    logger.info("test");

    expect(sink.entries[0].timestamp).toBeTruthy();
    expect(() => new Date(sink.entries[0].timestamp)).not.toThrow();
  });

  it("supports child loggers with component", () => {
    const sink = new CaptureSink();
    const logger = new StructuredLogger(sink, "INFO");
    const child = logger.child("config");

    child.info("loaded");

    expect(sink.entries[0].component).toBe("config");
  });

  it("supports nested child loggers", () => {
    const sink = new CaptureSink();
    const logger = new StructuredLogger(sink, "INFO");
    const child = logger.child("core").child("lifecycle");

    child.info("transition");

    expect(sink.entries[0].component).toBe("core.lifecycle");
  });

  it("supports execution ID", () => {
    const sink = new CaptureSink();
    const logger = new StructuredLogger(sink, "INFO");
    const withId = logger.withExecutionId("abc-123");

    withId.info("test");

    expect(sink.entries[0].executionId).toBe("abc-123");
  });

  it("includes optional data", () => {
    const sink = new CaptureSink();
    const logger = new StructuredLogger(sink, "INFO");

    logger.info("test", { key: "value", count: 42 });

    expect(sink.entries[0].data).toEqual({ key: "value", count: 42 });
  });

  it("supports TRACE level", () => {
    const sink = new CaptureSink();
    const logger = new StructuredLogger(sink, "TRACE");

    logger.trace("very detailed");

    expect(sink.entries[0].level).toBe("TRACE");
    expect(sink.entries[0].message).toBe("very detailed");
  });
});
