import { describe, expect, it } from "vitest";
import { isAnyProtocol, isAnySpec, isWanInterface, portSpecIncludes } from "./specs";

describe("isAnySpec", () => {
  it("treats empty, any and * as anywhere", () => {
    expect(isAnySpec(null)).toBe(true);
    expect(isAnySpec(undefined)).toBe(true);
    expect(isAnySpec("")).toBe(true);
    expect(isAnySpec("  ")).toBe(true);
    expect(isAnySpec("any")).toBe(true);
    expect(isAnySpec("ANY")).toBe(true);
    expect(isAnySpec("*")).toBe(true);
  });

  it("treats real specs as restricted", () => {
    expect(isAnySpec("10.0.1.0/24")).toBe(false);
    expect(isAnySpec("HomeLanSubnet")).toBe(false);
    expect(isAnySpec("+trusted-lan")).toBe(false);
    expect(isAnySpec("wanip")).toBe(false);
  });
});

describe("isAnyProtocol", () => {
  it("matches empty and any", () => {
    expect(isAnyProtocol(null)).toBe(true);
    expect(isAnyProtocol("any")).toBe(true);
    expect(isAnyProtocol("Any")).toBe(true);
    expect(isAnyProtocol("TCP")).toBe(false);
    expect(isAnyProtocol("TCP/UDP")).toBe(false);
  });
});

describe("isWanInterface", () => {
  it("matches wan-ish names case-insensitively", () => {
    expect(isWanInterface("WAN")).toBe(true);
    expect(isWanInterface("wan")).toBe(true);
    expect(isWanInterface("opt5")).toBe(false);
    expect(isWanInterface(null)).toBe(false);
    expect(isWanInterface("")).toBe(false);
  });
});

describe("portSpecIncludes", () => {
  it("matches single ports", () => {
    expect(portSpecIncludes("22", 22)).toBe(true);
    expect(portSpecIncludes("2222", 22)).toBe(false);
  });

  it("matches comma lists", () => {
    expect(portSpecIncludes("80,443,22", 22)).toBe(true);
    expect(portSpecIncludes("80,443", 22)).toBe(false);
  });

  it("matches ranges without expanding them", () => {
    expect(portSpecIncludes("4950-4955", 4951)).toBe(true);
    expect(portSpecIncludes("4950-4955", 4956)).toBe(false);
    expect(portSpecIncludes("1-65535", 3389)).toBe(true);
    expect(portSpecIncludes("20:23", 22)).toBe(true);
  });

  it("ignores empty specs and alias tokens", () => {
    expect(portSpecIncludes(null, 22)).toBe(false);
    expect(portSpecIncludes("", 22)).toBe(false);
    expect(portSpecIncludes("ssh_ports", 22)).toBe(false);
    expect(portSpecIncludes("ssh_ports,22", 22)).toBe(true);
  });
});
