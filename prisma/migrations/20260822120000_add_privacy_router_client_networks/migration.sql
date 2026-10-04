-- Privacy router: separate "the network the router sits on" from "the networks
-- whose traffic the router serves".
--
-- THE BUG THIS FIXES, found in live testing. A privacy router had ONE address
-- field, "lanCidr", discovered from the box's own interface, and it was used for
-- two unrelated jobs: the router's own addressing, and the scope of every
-- client-facing nftables rule. On the reference box that read:
--
--     chain PS_VPN_M_2 { ... ip saddr != 10.0.3.0/24 return ... }
--     chain PS_VPN_P_2 { oifname "psvpn-mi1" ip saddr 10.0.3.0/24 ... masquerade
--                        oifname "eth0"      ip saddr 10.0.3.0/24 ... masquerade }
--     chain PS_VPN_F_2 { ip saddr 10.0.3.0/24 udp dport 443 ... drop }
--
-- A phone on 10.0.4.125 — a different VLAN, which is the entire point of a
-- policy-routing gateway — matched none of it. Its traffic was never marked,
-- never redirected to the proxy, never QUIC-blocked, and crucially never
-- MASQUERADED, so it was forwarded straight back out eth0 still sourced
-- 10.0.4.125. OPNsense saw a packet it had just sent coming back with an
-- unexpected source, the return path collapsed, and the phone reported "address
-- unreachable" with nothing anywhere reporting a fault.
--
-- The router's own interface network stays as "lanCidr": it is still discovered,
-- still confirmed, and still what the one-armed explanation and the OPNsense
-- gateway walkthrough quote. The new column is the OTHER concept, and every
-- client-scoped rule now reads from it instead.
--
-- Forward-only and purely additive. Written by hand rather than amended into
-- 20260821120000_add_privacy_router, which has already been applied to a real
-- database.
--
-- Why TEXT[] rather than a join table: this is a short, ordered-by-nobody set of
-- opaque CIDR strings with no identity of its own, read in full on every apply
-- and never joined against. It is the same shape as EdgeServer."ingressHostnames"
-- and DnsRecord."resolvedIps", which is the precedent in this schema.
ALTER TABLE "PrivacyRouter" ADD COLUMN "clientNetworks" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Backfill from the value that was doing this job badly, so an upgrade changes
-- no behaviour: a router that served exactly its own subnet keeps serving
-- exactly its own subnet, and its next apply renders the same scope it renders
-- today. Rows whose topology was never confirmed stay empty — there is nothing
-- honest to backfill them with, and the apply already refuses them.
UPDATE "PrivacyRouter"
SET "clientNetworks" = ARRAY["lanCidr"]
WHERE "lanCidr" IS NOT NULL;
