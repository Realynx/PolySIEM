import type {
  AgentStreamEvent,
  AgentToolCall,
  ChatMessage,
} from "@/lib/ai/agent/contract";

type DocInterviewMode = "interview" | "services";

function mockDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function* mockStreamText(text: string): AsyncGenerator<AgentStreamEvent> {
  for (const word of text.split(" ")) {
    yield { type: "token", text: `${word} ` };
    await mockDelay(6);
  }
}

let mockDocSeq = 0;
async function* mockDocToolChip(
  kind: AgentToolCall["kind"],
  name: string,
  label: string,
  args: Record<string, unknown>,
  preview: string,
): AsyncGenerator<AgentStreamEvent, AgentToolCall> {
  mockDocSeq += 1;
  const base: AgentToolCall = {
    id: `mockdoc-${Date.now()}-${mockDocSeq}`,
    kind,
    name,
    args,
    label,
    status: "running",
  };
  yield { type: "tool_call", call: base };
  await mockDelay(110);
  const done: AgentToolCall = {
    ...base,
    status: "success",
    resultPreview: preview,
  };
  yield { type: "tool_result", call: done };
  return done;
}

const MOCK_INTERVIEW_QUESTIONS = [
  {
    question:
      "What is the primary purpose of vm-nextcloud, and who depends on it?",
    options: [
      {
        label: "Private file sync",
        answer:
          "It provides private file sync for household users and their mobile devices.",
        description: "Personal storage and device synchronization",
      },
      {
        label: "Team collaboration",
        answer:
          "It is our small-team collaboration hub for shared files, calendars, and contacts.",
      },
      {
        label: "Application storage",
        answer:
          "Other internal applications depend on it as their shared document store.",
      },
    ],
  },
  {
    question:
      "vm-nextcloud is on VLAN 20 (IoT). Is that intentional, and what access does it need?",
    options: [
      {
        label: "Reverse proxy only",
        answer:
          "The placement is intentional. Inbound access should come only through the reverse proxy, with normal outbound update access.",
      },
      {
        label: "LAN and internet",
        answer:
          "The placement is intentional; trusted LAN clients connect directly and the VM also needs outbound internet access.",
      },
      {
        label: "Needs moving",
        answer:
          "The IoT placement is accidental. It should move to the server VLAN and retain only reverse-proxy ingress.",
      },
    ],
  },
  {
    question: "How is vm-nextcloud backed up, and has restore been tested?",
    options: [
      {
        label: "Nightly snapshots",
        answer:
          "It receives nightly Proxmox snapshots, but a full restore has not been tested yet.",
      },
      {
        label: "App and off-site backup",
        answer:
          "The database and data directory are backed up nightly and copied off-site; restores are tested quarterly.",
      },
      {
        label: "Not backed up yet",
        answer:
          "There is no reliable backup yet. Add backup setup and a restore test as urgent TODOs.",
      },
    ],
  },
  {
    question: "If pve-node-01 fails, what is the recovery order?",
    options: [
      {
        label: "Restore VM first",
        answer:
          "Restore vm-nextcloud from the newest backup, start it, then verify the database, storage, and HTTPS endpoint.",
      },
      {
        label: "Dependencies first",
        answer:
          "Bring up DNS, storage, and the database first; then restore vm-nextcloud and finally the reverse proxy route.",
      },
      {
        label: "Manual recovery",
        answer:
          "Recovery is currently manual and undocumented. Mark the exact order and validation checks as TODOs.",
      },
    ],
  },
  {
    question: "Where are this service's credentials and certificates managed?",
    options: [
      {
        label: "Password manager",
        answer:
          "Administrative credentials are in the team password manager; certificates are managed by the reverse proxy.",
      },
      {
        label: "Secrets vault",
        answer:
          "Credentials and API tokens are stored in the internal secrets vault, and certificates renew automatically.",
      },
      {
        label: "Host configuration",
        answer:
          "Their locations are recorded in protected host configuration files; document the paths only, never their values.",
      },
    ],
  },
  {
    question: "What operational gotcha should the documentation emphasize?",
    options: [
      {
        label: "Upgrade order",
        answer:
          "Application upgrades must run one major version at a time, with maintenance mode enabled first.",
      },
      {
        label: "Storage pressure",
        answer:
          "Watch free space closely; failed uploads and database issues begin when the data volume is nearly full.",
      },
      {
        label: "No known gotchas",
        answer:
          "There are no known special gotchas beyond the normal backup and update procedure.",
      },
    ],
  },
];

/** Deterministic canned interview stream for mock:// demo mode. */
export async function* mockDocInterview(
  messages: ChatMessage[],
  mode: DocInterviewMode,
): AsyncGenerator<AgentStreamEvent, void> {
  const toolCalls: AgentToolCall[] = [];

  if (mode === "services") {
    toolCalls.push(
      yield* mockDocToolChip(
        "search_inventory",
        "search_inventory",
        'Search "vm-nextcloud"',
        { query: "vm-nextcloud", kinds: ["vm", "service"] },
        "1 vm, no matching service entry",
      ),
    );
    const plan = JSON.stringify({
      services: [
        {
          name: "Nextcloud",
          url: "https://nextcloud.example.test",
          port: 443,
          protocol: "https",
          description: "Private file sync and collaboration service.",
          target: { kind: "vm", id: "mock-vm-nextcloud", name: "vm-nextcloud" },
          evidence: "The operator confirmed this service during the interview.",
        },
      ],
      notes: ["Confirm the production URL before creating this demo entry."],
    });
    yield* mockStreamText(plan);
    yield { type: "done", content: plan, toolCalls };
    return;
  }

  // interview mode — how many real answers has the operator given so far?
  const answered = Math.max(
    0,
    messages.filter((m) => m.role === "user").length - 1,
  );

  if (answered === 0) {
    toolCalls.push(
      yield* mockDocToolChip(
        "search_inventory",
        "search_inventory",
        'Search "hosts"',
        { query: "hosts" },
        "3 devices, 2 vms, 4 containers",
      ),
    );
    toolCalls.push(
      yield* mockDocToolChip(
        "other",
        "list_networks",
        "List networks",
        {},
        "VLAN 10 (LAN), VLAN 20 (IoT), VLAN 30 (DMZ)",
      ),
    );
    const prompt = MOCK_INTERVIEW_QUESTIONS[0];
    toolCalls.push(
      yield* mockDocToolChip(
        "ask_question",
        "ask_question",
        prompt.question,
        { questions: [prompt] },
        `${prompt.options.length} suggested answers plus custom speech or text`,
      ),
    );
    const opener =
      "I found vm-nextcloud on pve-node-01 and checked its VLAN context.";
    yield* mockStreamText(opener);
    yield { type: "done", content: opener, toolCalls };
    return;
  }

  if (answered >= MOCK_INTERVIEW_QUESTIONS.length) {
    const complete =
      "The selected documentation scope is covered with no remaining mock assumptions. You can end the interview, or type another subject you want to document.";
    yield* mockStreamText(complete);
    yield { type: "done", content: complete, toolCalls };
    return;
  }

  const prompt =
    MOCK_INTERVIEW_QUESTIONS[
      Math.min(answered, MOCK_INTERVIEW_QUESTIONS.length - 1)
    ];
  // Occasionally pull data mid-interview so the user sees grounded tool calls.
  if (answered === 1) {
    toolCalls.push(
      yield* mockDocToolChip(
        "get_firewall_context",
        "get_firewall_rules",
        "Firewall rules (VLAN 20)",
        { interface: "iot" },
        "2 pass rules, 1 port-forward",
      ),
    );
  }
  toolCalls.push(
    yield* mockDocToolChip(
      "ask_question",
      "ask_question",
      prompt.question,
      { questions: [prompt] },
      `${prompt.options.length} suggested answers plus custom speech or text`,
    ),
  );
  const confirmation = "Thanks — I’ve incorporated that answer into the interview context.";
  yield* mockStreamText(confirmation);
  yield { type: "done", content: confirmation, toolCalls };
}
