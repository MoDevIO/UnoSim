import { describe, it, expect } from "vitest";
import { RingBuffer } from "../../../shared/utils/ring-buffer";

describe("RingBuffer", () => {
  it("starts empty", () => {
    const buf = new RingBuffer(32);
    expect(buf.isEmpty()).toBe(true);
    expect(buf.getSize()).toBe(0);
    expect(buf.getCapacity()).toBe(32);
    expect(buf.readAll()).toBe("");
  });

  it("writes and reads data", () => {
    const buf = new RingBuffer(64);
    buf.write("hello");
    expect(buf.isEmpty()).toBe(false);
    expect(buf.readAll()).toBe("hello");
    expect(buf.isEmpty()).toBe(true);
  });

  it("returns 0 for empty write", () => {
    const buf = new RingBuffer(32);
    expect(buf.write("")).toBe(0);
  });

  it("truncates when buffer is full", () => {
    const buf = new RingBuffer(4);
    const written = buf.write("abcdef");
    expect(written).toBe(4);
    expect(buf.isFull()).toBe(true);
    expect(buf.getAvailableSpace()).toBe(0);
    expect(buf.readAll()).toBe("abcd");
  });

  it("returns 0 bytes when writing to full buffer", () => {
    const buf = new RingBuffer(2);
    buf.write("ab");
    expect(buf.write("c")).toBe(0);
  });

  it("read(maxBytes) reads partial data", () => {
    const buf = new RingBuffer(32);
    buf.write("abcdef");
    expect(buf.read(3)).toBe("abc");
    expect(buf.getSize()).toBe(3);
    expect(buf.read(3)).toBe("def");
    expect(buf.isEmpty()).toBe(true);
  });

  it("read returns empty for 0 or negative maxBytes", () => {
    const buf = new RingBuffer(32);
    buf.write("abc");
    expect(buf.read(0)).toBe("");
    expect(buf.read(-1)).toBe("");
  });

  it("read returns empty on empty buffer", () => {
    const buf = new RingBuffer(32);
    expect(buf.read(10)).toBe("");
  });

  it("peek returns data without consuming it", () => {
    const buf = new RingBuffer(32);
    buf.write("peek");
    expect(buf.peek()).toBe("peek");
    expect(buf.getSize()).toBe(4);
    expect(buf.peek()).toBe("peek"); // still there
  });

  it("peek on empty buffer returns empty string", () => {
    const buf = new RingBuffer(32);
    expect(buf.peek()).toBe("");
  });

  it("clear empties the buffer", () => {
    const buf = new RingBuffer(32);
    buf.write("data");
    buf.clear();
    expect(buf.isEmpty()).toBe(true);
    expect(buf.getSize()).toBe(0);
  });

  it("handles wrap-around correctly", () => {
    const buf = new RingBuffer(8);
    buf.write("abcd"); // fills 4 bytes
    buf.read(4); // clears 4 bytes, readPos moves to 4
    buf.write("efghij"); // wraps around: 6 bytes starting at pos 4
    expect(buf.getSize()).toBe(6);
    expect(buf.readAll()).toBe("efghij");
  });
});
