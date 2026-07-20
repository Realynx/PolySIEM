import { afterEach, describe, expect, it, vi } from "vitest";
import type { DriverConfig } from "../types";
import { esFetch, testConnection } from "./client";

const config: DriverConfig = {
  id: "elastic-test",
  type: "ELASTICSEARCH",
  name: "Elastic test",
  baseUrl: "https://elastic.example.test:9200",
  credentials: { username: "reader", password: "secret" },
  verifyTls: true,
  settings: {},
};

afterEach(() => vi.unstubAllGlobals());

describe("Elasticsearch connection responses", () => {
  it("sends username/password credentials as HTTP Basic auth", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      void _url;
      void init;
      return new Response(JSON.stringify({ cluster_name: "lab", version: { number: "9.0.0" } }), {
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await esFetch(config, "/");

    expect(fetchMock).toHaveBeenCalledOnce();
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("reader:secret").toString("base64")}`);
  });

  it("explains when an HTML UI response is returned", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response("<!doctype html><title>Kibana</title>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    ));

    await expect(esFetch(config, "/")).rejects.toThrow(/Kibana address.*port 5601/i);
  });

  it("rejects a Kibana URL before sending credentials", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await testConnection({ ...config, baseUrl: "http://10.0.3.16:5601/" });

    expect(result).toEqual({ ok: false, detail: expect.stringMatching(/Kibana address.*port 5601/i) });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
