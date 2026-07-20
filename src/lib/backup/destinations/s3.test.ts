import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import {
  amzDates,
  buildCanonicalRequest,
  buildStringToSign,
  canonicalQueryString,
  deriveSigningKey,
  sha256Hex,
  uriEncode,
} from "./s3";

/**
 * The primary correctness check is AWS's own published "GET Object" example
 * from the SigV4 documentation (Signature Calculations for the Authorization
 * Header). If our canonical request, string-to-sign, signing-key chain and
 * final signature all match its documented values, the signer is correct.
 */
describe("SigV4 — AWS GET Object known-answer vector", () => {
  const SECRET = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
  const EMPTY_SHA = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  const amzDate = "20130524T000000Z";
  const scope = "20130524/us-east-1/s3/aws4_request";

  const { canonicalRequest, signedHeaders } = buildCanonicalRequest({
    method: "GET",
    canonicalUri: "/test.txt",
    canonicalQuery: "",
    headers: {
      host: "examplebucket.s3.amazonaws.com",
      range: "bytes=0-9",
      "x-amz-content-sha256": EMPTY_SHA,
      "x-amz-date": amzDate,
    },
    payloadHash: EMPTY_SHA,
  });

  it("produces the documented signed-header list", () => {
    expect(signedHeaders).toBe("host;range;x-amz-content-sha256;x-amz-date");
  });

  it("produces the documented canonical request", () => {
    expect(canonicalRequest).toBe(
      [
        "GET",
        "/test.txt",
        "",
        "host:examplebucket.s3.amazonaws.com",
        "range:bytes=0-9",
        `x-amz-content-sha256:${EMPTY_SHA}`,
        `x-amz-date:${amzDate}`,
        "",
        "host;range;x-amz-content-sha256;x-amz-date",
        EMPTY_SHA,
      ].join("\n"),
    );
  });

  it("hashes the canonical request to the documented value", () => {
    expect(sha256Hex(canonicalRequest)).toBe(
      "7344ae5b7ee6c3e7e6b0fe0640412a37625d1fbfff95c48bbb2dc43964946972",
    );
  });

  it("derives the documented final signature", () => {
    const stringToSign = buildStringToSign(amzDate, scope, canonicalRequest);
    const signingKey = deriveSigningKey(SECRET, "20130524", "us-east-1", "s3");
    const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");
    expect(signature).toBe("f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
  });
});

describe("deriveSigningKey", () => {
  it("is deterministic", () => {
    const a = deriveSigningKey("secret", "20260717", "us-east-1", "s3").toString("hex");
    const b = deriveSigningKey("secret", "20260717", "us-east-1", "s3").toString("hex");
    expect(a).toBe(b);
  });

  it("changes when any input changes", () => {
    const base = deriveSigningKey("secret", "20260717", "us-east-1", "s3").toString("hex");
    expect(deriveSigningKey("secret2", "20260717", "us-east-1", "s3").toString("hex")).not.toBe(base);
    expect(deriveSigningKey("secret", "20260718", "us-east-1", "s3").toString("hex")).not.toBe(base);
    expect(deriveSigningKey("secret", "20260717", "eu-west-1", "s3").toString("hex")).not.toBe(base);
  });
});

describe("uriEncode", () => {
  it("passes unreserved characters through unchanged", () => {
    expect(uriEncode("abcXYZ0189-_.~", false)).toBe("abcXYZ0189-_.~");
  });

  it("preserves slashes in path context, encodes them in query context", () => {
    expect(uriEncode("a b/c", false)).toBe("a%20b/c");
    expect(uriEncode("a b/c", true)).toBe("a%20b%2Fc");
  });

  it("percent-encodes reserved characters upper-case", () => {
    expect(uriEncode("=+:", true)).toBe("%3D%2B%3A");
  });

  it("encodes multi-byte UTF-8 correctly", () => {
    expect(uriEncode("é", false)).toBe("%C3%A9");
  });
});

describe("canonicalQueryString", () => {
  it("sorts and encodes query parameters", () => {
    expect(canonicalQueryString({ "list-type": "2", prefix: "polysiem/backups/" })).toBe(
      "list-type=2&prefix=polysiem%2Fbackups%2F",
    );
  });

  it("is empty for no params", () => {
    expect(canonicalQueryString({})).toBe("");
  });
});

describe("amzDates", () => {
  it("formats the SigV4 timestamp and date stamp", () => {
    expect(amzDates(new Date("2013-05-24T00:00:00.000Z"))).toEqual({
      amzDate: "20130524T000000Z",
      dateStamp: "20130524",
    });
  });
});
