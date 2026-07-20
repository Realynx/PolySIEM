/**
 * Mock AI backend used when the Ollama base URL starts with "mock://" or
 * MOCK_AI=true. Streams a canned, task-appropriate response word by word so
 * the full streaming pipeline (NDJSON-free path, chunked transfer, client
 * reader) can be exercised without a real Ollama instance.
 */

export const MOCK_MODELS = ["demo-model:latest", "llama3.2:3b"];

const RESPONSES: Array<{ match: RegExp; text: string }> = [
  {
    match: /firewall rule/i,
    text:
      "This rule permits inbound TCP traffic on the LAN interface toward the destination host on the listed port. " +
      "It most likely exists so internal clients can reach that service directly, while the interface's default " +
      "deny policy continues to block everything else.",
  },
  {
    match: /2-4 sentence markdown description/i,
    text:
      "**This host** serves as a core piece of the homelab, providing storage and supporting services to the rest " +
      "of the network. It runs on modest but reliable hardware, is reachable on the management VLAN, and is " +
      "monitored through the dashboard. Nightly jobs depend on it, so uptime matters here.",
  },
  {
    match: /rewrite the following text/i,
    text:
      "The server handles several scheduled tasks for the lab: it runs nightly backups, serves media over SMB, " +
      "and hosts a handful of internal tools. Its configuration is managed manually, so any changes should be " +
      "documented here before they are applied.",
  },
  {
    match: /summarize the following text/i,
    text:
      "- Provides core services for the homelab network\n" +
      "- Runs scheduled backup and maintenance jobs overnight\n" +
      "- Reachable on the management VLAN with a static address\n" +
      "- Configuration is manual, so changes should be documented\n" +
      "- Uptime matters because other systems depend on it",
  },
  {
    match: /continue writing/i,
    text:
      "In addition, the machine exposes a small set of internal services that other hosts depend on. Backups run " +
      "nightly at 02:00 and are verified each weekend. If the box becomes unreachable, check the switch port and " +
      "the UPS before assuming a hardware fault.",
  },
];

const FALLBACK =
  "This is a mock AI response streamed word by word for local development. It stands in for a real Ollama model, " +
  "letting the dashboard exercise streaming, cancellation, and rendering without any inference backend running.";

function pickResponse(prompt: string): string {
  for (const r of RESPONSES) {
    if (r.match.test(prompt)) return r.text;
  }
  return FALLBACK;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Canned JSON findings for the mock log scanner, keyed by the scope name that
 * appears in the prompt. Believable homelab content so the threat-watch panel
 * is demoable end-to-end without Ollama or Elasticsearch.
 */
const MOCK_SCAN_FINDINGS: Record<string, unknown> = {
  suricata: {
    findings: [
      {
        title: "Repeated ET SCAN alerts from a single external host",
        severity: "high",
        category: "recon",
        summary:
          "Suricata raised 47 alerts for signature \"ET SCAN Suspicious inbound to mySQL port 3306\" from 185.220.101.34 " +
          "toward 10.0.20.15 within the scan window. The source also probed ports 22 and 8006, which suggests a broad " +
          "service sweep rather than a targeted exploit. No corresponding PASS traffic from the target was observed.",
        suggestions:
          "1. Confirm the firewall blocks WAN access to 3306 and 8006.\n2. Add 185.220.101.34 to a block alias.\n" +
          "3. Review whether 10.0.20.15 needs any inbound exposure at all.",
        dedupe: "et-scan-mysql-185.220.101.34",
        matchesExisting: null,
        refs: {
          srcIps: ["185.220.101.34"],
          destIps: ["10.0.20.15"],
          signatures: ["ET SCAN Suspicious inbound to mySQL port 3306"],
        },
      },
      {
        title: "Outbound DNS queries to a newly observed domain flagged by IDS",
        severity: "medium",
        category: "anomaly",
        summary:
          "A host on the trusted VLAN (10.0.1.42) generated repeated DNS lookups matching signature " +
          "\"ET INFO Observed DNS Query to .top TLD\". The volume (~120 queries/hour) is unusual for this host and " +
          "started mid-window, which can indicate adware or a misbehaving container.",
        suggestions:
          "1. Identify the process on 10.0.1.42 issuing the lookups.\n2. Check AdGuard query logs for the exact domain.\n" +
          "3. Consider a DNS block for the .top domain if unneeded.",
        dedupe: "dns-top-tld-10.0.1.42",
        matchesExisting: null,
        refs: { srcIps: ["10.0.1.42"], signatures: ["ET INFO Observed DNS Query to .top TLD"] },
      },
    ],
  },
  cloudflared: {
    findings: [
      {
        title: "Cloudflared tunnel connection errors spiking",
        severity: "low",
        category: "traffic",
        summary:
          "The cloudflared tunnel logged 23 \"failed to connect to origin\" errors during the window, all pointing at " +
          "the Nextcloud origin. The tunnel recovered each time, so this looks like intermittent origin latency rather " +
          "than an outage, but it is above the usual background rate.",
        suggestions: "1. Check Nextcloud host load during the window.\n2. Raise the origin connect timeout if this recurs.",
        dedupe: "cloudflared-origin-errors-nextcloud",
        matchesExisting: null,
        refs: { hosts: ["nextcloud"] },
      },
    ],
  },
  general: {
    findings: [
      {
        title: "Authentication failure burst on OPNsense",
        severity: "medium",
        category: "auth",
        summary:
          "The general error digest shows 15 sshd authentication failures on the firewall within ten minutes, all from " +
          "10.0.1.77. That host is on the trusted VLAN, so this is more likely a stale credential in an automation job " +
          "than an attack, but it should be identified.",
        suggestions: "1. Find what runs on 10.0.1.77 with stored firewall credentials.\n2. Rotate the credential it is using.",
        dedupe: "ssh-authfail-opnsense-10.0.1.77",
        matchesExisting: null,
        refs: { srcIps: ["10.0.1.77"], hosts: ["opnsense"] },
      },
    ],
  },
};

/** Non-streaming mock for generateJson: canned findings chosen by scope keyword. */
export async function mockGenerateJson(prompt: string): Promise<string> {
  await delay(400); // simulate inference latency
  for (const [scope, findings] of Object.entries(MOCK_SCAN_FINDINGS)) {
    if (prompt.toLowerCase().includes(scope)) return JSON.stringify(findings);
  }
  return JSON.stringify({ findings: [] });
}

/** Stream a canned response as word-by-word chunks with small delays. */
export async function* mockGenerate(prompt: string, signal?: AbortSignal): AsyncGenerator<string> {
  const words = pickResponse(prompt).split(" ");
  for (let i = 0; i < words.length; i++) {
    if (signal?.aborted) return;
    yield i === 0 ? words[i] : ` ${words[i]}`;
    await delay(25);
  }
}
