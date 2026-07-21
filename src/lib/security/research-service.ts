import "server-only";
import { isIP } from "node:net";
import { randomUUID } from "node:crypto";
import { domainToASCII } from "node:url";
import { resolve4, resolve6, resolveCname, resolveMx, resolveNs, resolveTxt, reverse } from "node:dns/promises";
import { Prisma } from "@prisma/client";
import { ApiError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { gatherIpIdentity, queryLogsForTerm } from "@/lib/ai/agent/research";
import { lookupCensysHost } from "@/lib/services/censys";
import type { CreateSecurityResearchPageInput, UpdateSecurityResearchPageInput } from "@/lib/validators/security-research";

const researchInclude = {
  createdBy: { select: { id: true, username: true, displayName: true } },
  evidence: { orderBy: { capturedAt: "desc" as const } },
} as const;

type EvidenceDraft = {
  provider: string;
  kind: string;
  status?: "success" | "error" | "unavailable";
  title: string;
  summary?: string | null;
  query?: string | null;
  sourceUrl?: string | null;
  data: unknown;
};

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown provider error";
}

function classifySubject(raw: string): { subject: string; subjectType: "ip" | "domain" } {
  const candidate = raw.trim().toLowerCase();
  if (isIP(candidate)) return { subject: candidate, subjectType: "ip" };
  const ascii = domainToASCII(candidate).replace(/\.$/, "");
  const labels = ascii.split(".");
  if (
    ascii.length > 253 || labels.length < 2 ||
    labels.some((label) => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))
  ) {
    throw new ApiError(400, "invalid_research_subject", "Enter a valid IP address or domain name.");
  }
  return { subject: ascii, subjectType: "domain" };
}

async function within<T>(promise: Promise<T>, label: string, timeoutMs = 8_000): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function dnsEvidence(subject: string, subjectType: "ip" | "domain") {
  if (subjectType === "ip") {
    const names = await within(reverse(subject), "Reverse DNS");
    return { reverseNames: names };
  }

  const lookups = await Promise.allSettled([
    within(resolve4(subject), "IPv4 DNS"),
    within(resolve6(subject), "IPv6 DNS"),
    within(resolveCname(subject), "CNAME DNS"),
    within(resolveMx(subject), "MX DNS"),
    within(resolveNs(subject), "NS DNS"),
    within(resolveTxt(subject), "TXT DNS"),
  ]);
  const value = <T>(index: number, fallback: T): T => lookups[index]?.status === "fulfilled"
    ? lookups[index].value as T
    : fallback;
  return {
    a: value<string[]>(0, []),
    aaaa: value<string[]>(1, []),
    cname: value<string[]>(2, []),
    mx: value<Array<{ exchange: string; priority: number }>>(3, []),
    ns: value<string[]>(4, []),
    txt: value<string[][]>(5, []).map((parts) => parts.join("")),
    lookupErrors: lookups.flatMap((result, index) => result.status === "rejected"
      ? [{ recordType: ["A", "AAAA", "CNAME", "MX", "NS", "TXT"][index], message: errorMessage(result.reason) }]
      : []),
  };
}

async function inventoryEvidence(subject: string, subjectType: "ip" | "domain") {
  if (subjectType === "ip") return gatherIpIdentity(subject);
  const [tunnelHostnames, services] = await Promise.all([
    prisma.tunnelHostname.findMany({
      where: { hostname: { equals: subject, mode: "insensitive" } },
      select: {
        hostname: true,
        resolvedIps: true,
        proxied: true,
        lastResolvedAt: true,
        tunnel: { select: { id: true, name: true, provider: true, originIp: true } },
      },
    }),
    prisma.service.findMany({
      where: { url: { contains: subject, mode: "insensitive" } },
      select: { id: true, name: true, url: true, status: true },
      take: 25,
    }),
  ]);
  return { tunnelHostnames, services };
}

async function capture(
  drafts: EvidenceDraft[],
  provider: string,
  kind: string,
  title: string,
  query: string,
  action: () => Promise<unknown>,
  summary: (value: unknown) => string,
  sourceUrl?: string,
) {
  try {
    const data = await action();
    drafts.push({ provider, kind, title, query, sourceUrl, data, summary: summary(data), status: "success" });
  } catch (error) {
    drafts.push({
      provider, kind, title, query, sourceUrl, status: "error",
      summary: errorMessage(error), data: { error: errorMessage(error) },
    });
  }
}

export async function listSecurityResearchPages() {
  return prisma.securityResearchPage.findMany({
    include: researchInclude,
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
  });
}

export async function getSecurityResearchPage(id: string) {
  const page = await prisma.securityResearchPage.findUnique({ where: { id }, include: researchInclude });
  if (!page) throw new ApiError(404, "research_page_not_found", "Research page not found.");
  return page;
}

export async function createSecurityResearchPage(input: CreateSecurityResearchPageInput, userId: string) {
  const { subject, subjectType } = classifySubject(input.subject);
  return prisma.securityResearchPage.create({
    data: {
      title: input.title?.trim() || `Research: ${subject}`,
      subject,
      subjectType,
      createdById: userId,
    },
    include: researchInclude,
  });
}

export async function updateSecurityResearchPage(id: string, input: UpdateSecurityResearchPageInput) {
  await getSecurityResearchPage(id);
  return prisma.securityResearchPage.update({
    where: { id },
    data: input,
    include: researchInclude,
  });
}

export async function deleteSecurityResearchPage(id: string) {
  await getSecurityResearchPage(id);
  await prisma.securityResearchPage.delete({ where: { id } });
}

export type SecurityResearchProvider = "dns" | "polysiem" | "elasticsearch" | "censys" | "securitytrails";
const DEFAULT_RESEARCH_PROVIDERS: SecurityResearchProvider[] = ["dns", "polysiem", "elasticsearch", "securitytrails"];

export async function collectSecurityResearch(
  id: string,
  hours = 24,
  forceRefresh = false,
  providers: SecurityResearchProvider[] = DEFAULT_RESEARCH_PROVIDERS,
) {
  const page = await getSecurityResearchPage(id);
  const runId = randomUUID();
  const drafts: EvidenceDraft[] = [];
  const selected = new Set(providers);

  let dns: Awaited<ReturnType<typeof dnsEvidence>> | undefined;
  if (selected.has("dns")) {
    await capture(drafts, "dns", "resolution", "Current DNS records", page.subject, async () => {
      dns = await dnsEvidence(page.subject, page.subjectType as "ip" | "domain");
      return dns;
    }, (value) => {
      const record = value as Record<string, unknown>;
      const count = Object.values(record).reduce<number>((total, item) => total + (Array.isArray(item) ? item.length : 0), 0);
      return `${count} DNS record${count === 1 ? "" : "s"} captured.`;
    });
  }

  if (selected.has("polysiem")) {
    await capture(drafts, "polysiem", "inventory", "Lab inventory matches", page.subject,
      () => inventoryEvidence(page.subject, page.subjectType as "ip" | "domain"),
      (value) => `${JSON.stringify(value).length > 10 ? "Related inventory context captured." : "No matching inventory context found."}`,
    );
  }

  if (selected.has("elasticsearch")) {
    await capture(drafts, "elasticsearch", "logs", `Log activity · last ${hours}h`, page.subject,
      () => queryLogsForTerm(page.subject, hours),
      (value) => {
        const total = Number((value as { totalMatches?: number }).totalMatches ?? 0);
        return `${total.toLocaleString()} matching log event${total === 1 ? "" : "s"}.`;
      },
    );
  }

  if (selected.has("censys")) {
    if (!dns && page.subjectType === "domain") {
      try { dns = await dnsEvidence(page.subject, "domain"); } catch { /* Captured below as no resolved addresses. */ }
    }
    const addresses = page.subjectType === "ip"
      ? [page.subject]
      : [...new Set([
          ...((dns && "a" in dns ? dns.a : []) ?? []),
          ...((dns && "aaaa" in dns ? dns.aaaa : []) ?? []),
        ])].slice(0, 4);

    if (addresses.length === 0 && page.subjectType === "domain") {
      drafts.push({
        provider: "censys", kind: "host", title: "Censys host intelligence", query: page.subject,
        status: "unavailable", summary: "No A or AAAA records were available to look up in Censys.", data: { addresses: [] },
      });
    }
    for (const address of addresses) {
      await capture(drafts, "censys", "host", `Censys host · ${address}`, address,
        () => lookupCensysHost(address, { source: "manual", forceRefresh }),
        (value) => {
          const result = value as {
            host?: { serviceCount?: number; ownership?: { organization?: string } };
            cached?: boolean;
            estimatedProviderCredits?: number;
          };
          const host = result.host;
          const cost = result.cached ? "cache hit · no new Censys credit" : `${result.estimatedProviderCredits ?? 1} Censys credit`;
          return `${host?.serviceCount ?? 0} exposed services · ${cost}${host?.ownership?.organization ? ` · ${host.ownership.organization}` : ""}.`;
        }, `https://search.censys.io/hosts/${encodeURIComponent(address)}`,
      );
    }
  }

  // SecurityTrails is collected through the same provider boundary once the
  // integration is configured. Import lazily so the notebook still works on
  // deployments upgrading from a schema without that integration.
  if (selected.has("securitytrails")) {
    try {
      const provider = await import("@/lib/services/securitytrails");
      if (page.subjectType === "domain") {
        const options = { source: "manual" as const, forceRefresh };
        await capture(drafts, "securitytrails", "domain", "SecurityTrails current DNS", page.subject,
          () => provider.lookupSecurityTrailsDomain(page.subject, options),
          () => "Current DNS infrastructure evidence captured.",
          `https://securitytrails.com/domain/${encodeURIComponent(page.subject)}/dns`,
        );
        await capture(drafts, "securitytrails", "subdomains", "SecurityTrails subdomains", page.subject,
          () => provider.lookupSecurityTrailsSubdomains(page.subject, options),
          (value) => `${Number((value as { data?: { count?: number } }).data?.count ?? 0).toLocaleString()} known subdomains.`,
          `https://securitytrails.com/domain/${encodeURIComponent(page.subject)}/dns`,
        );
        await capture(drafts, "securitytrails", "domain_whois", "SecurityTrails WHOIS", page.subject,
          () => provider.lookupSecurityTrailsDomainWhois(page.subject, options),
          () => "Registration and ownership evidence captured.",
          `https://securitytrails.com/domain/${encodeURIComponent(page.subject)}/whois`,
        );
      } else {
        await capture(drafts, "securitytrails", "ip_whois", "SecurityTrails IP WHOIS", page.subject,
          () => provider.lookupSecurityTrailsIpWhois(page.subject, { source: "manual", forceRefresh }),
          () => "Network ownership evidence captured.",
        );
      }
    } catch (error) {
      drafts.push({
        provider: "securitytrails", kind: page.subjectType, title: "SecurityTrails intelligence",
        query: page.subject, status: "unavailable", summary: errorMessage(error), data: { error: errorMessage(error) },
      });
    }
  }

  const capturedAt = new Date();
  await prisma.$transaction([
    prisma.securityResearchEvidence.createMany({
      data: drafts.map((draft) => ({
        pageId: page.id,
        runId,
        provider: draft.provider,
        kind: draft.kind,
        status: draft.status ?? "success",
        title: draft.title,
        summary: draft.summary ?? null,
        query: draft.query ?? null,
        sourceUrl: draft.sourceUrl ?? null,
        data: json(draft.data),
        capturedAt,
      })),
    }),
    prisma.securityResearchPage.update({ where: { id: page.id }, data: { lastResearchedAt: capturedAt } }),
  ]);

  return getSecurityResearchPage(page.id);
}
