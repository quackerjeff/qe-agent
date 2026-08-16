export class BoundedBuffer {
  private headBuf: Buffer;
  private tailBuf: Buffer;
  private headLen = 0;
  private tailLen = 0;
  private totalBytes = 0;
  private readonly headCap: number;
  private readonly tailCap: number;

  constructor(maxBytes: number) {
    this.headCap = Math.floor(maxBytes / 2);
    this.tailCap = maxBytes - this.headCap;
    this.headBuf = Buffer.alloc(this.headCap);
    this.tailBuf = Buffer.alloc(this.tailCap);
  }

  append(chunk: Buffer): void {
    const len = chunk.length;
    this.totalBytes += len;

    const headRoom = this.headCap - this.headLen;
    if (headRoom > 0) {
      const take = Math.min(len, headRoom);
      chunk.copy(this.headBuf, this.headLen, 0, take);
      this.headLen += take;
      if (take === len) return;
      this.appendToTail(chunk.subarray(take));
    } else {
      this.appendToTail(chunk);
    }
  }

  private appendToTail(chunk: Buffer): void {
    const len = chunk.length;
    if (len >= this.tailCap) {
      chunk.copy(this.tailBuf, 0, len - this.tailCap, len);
      this.tailLen = this.tailCap;
    } else if (this.tailLen + len <= this.tailCap) {
      chunk.copy(this.tailBuf, this.tailLen, 0, len);
      this.tailLen += len;
    } else {
      const shift = this.tailLen + len - this.tailCap;
      this.tailBuf.copy(this.tailBuf, 0, shift, this.tailLen);
      this.tailLen -= shift;
      chunk.copy(this.tailBuf, this.tailLen, 0, len);
      this.tailLen += len;
    }
  }

  finish(): { text: string; truncated: boolean; totalBytes: number } {
    if (this.totalBytes <= this.headCap + this.tailCap) {
      const combined = Buffer.concat([
        this.headBuf.subarray(0, this.headLen),
        this.tailBuf.subarray(0, this.tailLen),
      ]);
      return {
        text: combined.toString("utf-8"),
        truncated: false,
        totalBytes: this.totalBytes,
      };
    }

    const head = this.headBuf.subarray(0, this.headLen).toString("utf-8");
    const tail = this.tailBuf.subarray(0, this.tailLen).toString("utf-8");
    const marker = `\n\n--- OUTPUT TRUNCATED (${this.totalBytes} bytes, limit ${this.headCap + this.tailCap}) ---\n\n`;

    return {
      text: head + marker + tail,
      truncated: true,
      totalBytes: this.totalBytes,
    };
  }
}
