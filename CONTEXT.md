# PolySIEM domain context

## Inventory and evidence

- **Asset** — A durable thing PolySIEM documents, such as a hypervisor, VM, container, firewall, or switch. An inventory integration owns the lifecycle of the assets it creates.
- **Configured address** — An IP address declared in an asset or interface configuration. It is direct configuration evidence, not proof that the address is currently reachable.
- **Network observation** — An address, MAC, or hostname seen by a network integration through DHCP, ARP, neighbor discovery, or a similar runtime source. Observations describe what the network saw; they do not own the matching asset.
- **Address claim** — One integration's evidence that an asset or MAC uses an IP address. Claims retain their source and may agree, complement, or conflict with other claims.
- **Resolved footprint** — The derived topology view produced by conservatively joining assets, configured addresses, and network observations. It is not itself a new source of inventory truth.

## Identity resolution

- Exact normalized MAC address is the preferred cross-integration join key for an interface.
- A MAC observation is attached to an asset only when that MAC identifies exactly one active asset interface. Ambiguous matches stay as independent network observations.
- Configured addresses are retained even when no network integration observes them. Observed addresses fill gaps and never overwrite configuration owned by another integration.
- Hostname similarity alone is insufficient to merge assets or attach addresses.

## Firewall evidence

- **Gateway policy** — Inter-network policy enforced by a router or firewall integration, such as OPNsense.
- **Workload policy** — Datacenter, security-group, or guest-local policy enforced around a hypervisor workload, such as Proxmox firewall rules.
- Gateway and workload policies are complementary layers. The access map may derive both, but must not reinterpret workload rules as gateway routing policy.

## Edge networks

- **Edge NAT Server** — A small remote Linux host that owns a public packet boundary and forwards only explicitly managed listeners toward the private lab. Its public address replaces the home WAN address at the packet layer, but it is not proof that applications, DNS, logs, or WebRTC cannot reveal other addresses.
- **Edge NAT listener interface** — The Linux interface on which published traffic arrives. It describes a traffic role, not a permanently “public” network zone.
- **Edge NAT target-path interface** — The Linux interface selected by the route toward the DNAT target. It may be the same as the listener interface when a single-NIC edge server forwards to a public residential address, or a tunnel interface such as `tailscale0` when the target is private.
- **Edge NAT Rule** — PolySIEM's desired TCP or UDP mapping on one Edge NAT Server. A saved rule is not evidence of reachability until the server confirms that revision was applied.
- **Applied edge rule** — A desired Edge NAT Rule whose managed remote firewall state has been verified. Only applied rules may contribute reachable paths to topology views.
- **Edge Networks** — A derived operational view combining Edge NAT, Tailscale, Cloudflare, firewall, and observed routing evidence. It does not own or silently merge the underlying providers' source data.
- **Connector** — A PolySIEM-managed agent on an internal machine that dials out to an Edge NAT Server over WireGuard and holds the tunnel open. It requires no public IP, no inbound port, and no inbound SSH: the agent pulls its desired configuration and performs the final hop to the target itself.
- **Connector ID** — The stable public identifier of one connector. It is quoted in install output and route configuration; it is not a credential, and it is unrelated to the one-time install token that enrolls the agent.
- **Implicit tunnel address** — The tunnel IP PolySIEM allocates to a connector at creation. It is derived from the edge tunnel subnet and is never entered by an operator, so it is control-plane bookkeeping rather than declared configuration.
- **Direct route mode** — An Edge NAT Rule whose edge DNATs straight to a target the edge itself can reach. This is the original primitive and remains the default.
- **Connector route mode** — An Edge NAT Rule whose edge forwards the published port over the tunnel to a chosen connector, which then reaches the target as seen from the connector. Both modes coexist in one applied ruleset; a saved connector rule is not evidence of reachability until the connector has enrolled and the revision is applied.
