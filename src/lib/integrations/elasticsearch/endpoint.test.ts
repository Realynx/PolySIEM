import { describe, expect, it } from "vitest";
import {
  getElasticsearchEndpointIssue,
  KIBANA_ENDPOINT_MESSAGE,
} from "./endpoint";

describe("getElasticsearchEndpointIssue", () => {
  it("recognizes the default Kibana port", () => {
    expect(getElasticsearchEndpointIssue("http://10.0.3.16:5601/"))
      .toBe(KIBANA_ENDPOINT_MESSAGE);
  });

  it("recognizes a Kibana application path", () => {
    expect(getElasticsearchEndpointIssue("https://logs.example.test/app/home"))
      .toBe(KIBANA_ENDPOINT_MESSAGE);
  });

  it("allows a normal Elasticsearch endpoint", () => {
    expect(getElasticsearchEndpointIssue("https://10.0.3.16:9200"))
      .toBeNull();
  });
});
