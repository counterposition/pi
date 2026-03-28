import { describe, expect, it } from "vitest";

import { validateFetchUrl } from "../src/url-safety.js";

describe("validateFetchUrl", () => {
  it("accepts normal public http and https URLs", () => {
    expect(validateFetchUrl(" https://example.com/docs ")).toBe("https://example.com/docs");
    expect(validateFetchUrl("http://example.com")).toBe("http://example.com/");
  });

  it("blocks obvious localhost and metadata targets", () => {
    expect(() => validateFetchUrl("http://localhost:3000")).toThrow(/blocked url/i);
    expect(() => validateFetchUrl("http://169.254.169.254/latest/meta-data")).toThrow(
      /blocked url/i,
    );
  });

  it("blocks private and loopback IP ranges", () => {
    expect(() => validateFetchUrl("http://127.0.0.1")).toThrow(/blocked url/i);
    expect(() => validateFetchUrl("http://192.168.1.20")).toThrow(/blocked url/i);
    expect(() => validateFetchUrl("http://10.0.0.5")).toThrow(/blocked url/i);
  });

  it("blocks embedded credentials and non-http schemes", () => {
    expect(() => validateFetchUrl("https://user:pass@example.com")).toThrow(/credentials/i);
    expect(() => validateFetchUrl("file:///tmp/test.txt")).toThrow(/only http and https/i);
  });
});
