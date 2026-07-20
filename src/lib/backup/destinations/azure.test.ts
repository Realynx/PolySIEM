import { describe, expect, it } from "vitest";
import {
  buildAzureStringToSign,
  canonicalizedHeaders,
  rfc1123Date,
  signAzureSharedKey,
} from "./azure";

describe("rfc1123Date", () => {
  it("formats the Azure x-ms-date header", () => {
    expect(rfc1123Date(new Date("2013-05-24T00:00:00.000Z"))).toBe("Fri, 24 May 2013 00:00:00 GMT");
  });
});

describe("canonicalizedHeaders", () => {
  it("keeps only x-ms-* headers, lower-cased and sorted", () => {
    expect(
      canonicalizedHeaders({
        "x-ms-version": "2021-08-06",
        "Content-Type": "text/plain",
        "x-ms-date": "Fri, 24 May 2013 00:00:00 GMT",
        "x-ms-blob-type": "BlockBlob",
      }),
    ).toBe("x-ms-blob-type:BlockBlob\nx-ms-date:Fri, 24 May 2013 00:00:00 GMT\nx-ms-version:2021-08-06");
  });

  it("collapses internal whitespace in header values", () => {
    expect(canonicalizedHeaders({ "x-ms-meta-note": "a   b\tc" })).toBe("x-ms-meta-note:a b c");
  });
});

describe("buildAzureStringToSign", () => {
  it("lays out the Shared Key string-to-sign exactly", () => {
    const stringToSign = buildAzureStringToSign({
      method: "PUT",
      contentLength: 21,
      contentType: "text/plain",
      canonicalizedResource: "/myaccount/mycontainer/backup.gz",
      xmsHeaders: {
        "x-ms-blob-type": "BlockBlob",
        "x-ms-date": "Fri, 24 May 2013 00:00:00 GMT",
        "x-ms-version": "2021-08-06",
      },
    });
    // 12 fixed fields (VERB..Range) + the canonicalized header lines + resource.
    expect(stringToSign).toBe(
      [
        "PUT",
        "",
        "",
        "21",
        "",
        "text/plain",
        "",
        "",
        "",
        "",
        "",
        "",
        "x-ms-blob-type:BlockBlob",
        "x-ms-date:Fri, 24 May 2013 00:00:00 GMT",
        "x-ms-version:2021-08-06",
        "/myaccount/mycontainer/backup.gz",
      ].join("\n"),
    );
  });

  it("blanks Content-Length when zero (per the 2015-02-21+ contract)", () => {
    const s = buildAzureStringToSign({
      method: "GET",
      contentLength: 0,
      contentType: "",
      canonicalizedResource: "/a/c",
      xmsHeaders: { "x-ms-date": "d", "x-ms-version": "2021-08-06" },
    });
    expect(s.split("\n")[3]).toBe(""); // Content-Length line is empty
  });
});

describe("signAzureSharedKey", () => {
  const key = Buffer.from("polysiem-test-account-key").toString("base64");

  it("is deterministic for identical inputs", () => {
    const a = signAzureSharedKey(key, "string-to-sign");
    const b = signAzureSharedKey(key, "string-to-sign");
    expect(a).toBe(b);
  });

  it("changes when the string-to-sign changes", () => {
    expect(signAzureSharedKey(key, "a")).not.toBe(signAzureSharedKey(key, "b"));
  });

  it("returns a 44-char base64 HMAC-SHA256 digest", () => {
    expect(signAzureSharedKey(key, "anything")).toMatch(/^[A-Za-z0-9+/]{43}=$/);
  });
});
