import type { NetworkInsights } from "@/lib/types";
import { mergeCountrySeries } from "./insights-series";

/* ------------------------------------------------------------------ */
/* Mock fixtures (mock://demo)                                         */
/* ------------------------------------------------------------------ */

/** Evenly spread demo timestamps across the window, newest first. */
function demoTimes(hours: number, count: number): string[] {
  const now = Date.now();
  const stepMs = (hours * 3_600_000) / (count + 1);
  return Array.from({ length: count }, (_, i) => new Date(now - (i + 1) * stepMs).toISOString());
}

/** Deterministic demo dashboard for mock://demo integrations. */
export function mockNetworkInsights(hours: number): NetworkInsights {
  const t = demoTimes(hours, 10);
  const origins = mergeCountrySeries(
    [
      { key: "United States", doc_count: 1240 },
      { key: "The Netherlands", doc_count: 96 },
      { key: "Germany", doc_count: 41 },
      { key: "Russia", doc_count: 17 },
    ],
    [
      { key: "United States", doc_count: 2310 },
      { key: "Canada", doc_count: 512 },
      { key: "Sri Lanka", doc_count: 208 },
      { key: "Brazil", doc_count: 77 },
      { key: "France", doc_count: 12 },
    ],
  );
  return {
    windowHours: hours,
    detected: { suricata: ["logs-demo"], cloudflared: ["cloudflared-demo"] },
    stats: { totalEvents: 48_211, idsAlerts: 1394, cloudflaredRequests: 3119, sourceCountries: origins.length },
    origins: {
      total: 4513,
      rows: origins,
      points: [
        { lat: 39.0, lon: -77.5, count: 1816, series: "visitors" }, // Ashburn
        { lat: 41.9, lon: -87.6, count: 640, series: "visitors" }, // Chicago
        { lat: 6.9, lon: 79.9, count: 288, series: "visitors" }, // Colombo
        { lat: 43.7, lon: -79.4, count: 152, series: "visitors" }, // Toronto
        { lat: 52.5, lon: 13.4, count: 61, series: "visitors" }, // Berlin
        { lat: 37.5, lon: -122.2, count: 940, series: "ids" }, // Bay Area
        { lat: 40.7, lon: -74.0, count: 310, series: "ids" }, // New York
        { lat: 51.5, lon: -0.1, count: 84, series: "ids" }, // London
        { lat: 1.35, lon: 103.8, count: 22, series: "ids" }, // Singapore
      ],
    },
    cloudflareInbound: {
      total: 3119,
      rows: [
        { ip: "159.26.96.63", count: 1816 },
        { ip: "173.239.196.183", count: 641 },
        { ip: "159.203.60.55", count: 287 },
        { ip: "35.183.0.56", count: 214 },
        { ip: "2a06:98c0:3600::103", count: 161 },
      ],
    },
    bootLogs: {
      total: 3,
      rows: [
        { timestamp: t[0], message: "unbound_configure_do[504] done." },
        { timestamp: t[1], message: "plugins_configure dhcp (execute task : dhcpd_dhcp4_configure())" },
        { timestamp: t[2], message: "OPNsense 25.1 (amd64) booting..." },
      ],
    },
    cloudflaredConnections: {
      total: 3119,
      rows: [
        {
          timestamp: t[0],
          host: "obsidiancloudflared",
          url: "https://cloud.demo.lan/apps/files/",
          sourceIp: "159.26.96.63",
          city: "Chicago",
          region: "Illinois",
          country: "United States",
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/141.0",
        },
        {
          timestamp: t[1],
          host: "obsidiancloudflared",
          url: "https://docs.demo.lan/wp-admin/install.php?step=1",
          sourceIp: "2a06:98c0:3600::103",
          city: null,
          region: null,
          country: "United States",
          userAgent: "curl/8.5.0",
        },
        {
          timestamp: t[2],
          host: "cloudflareconsult",
          url: "https://media.demo.lan/api/media/status",
          sourceIp: "173.239.196.183",
          city: "Colombo",
          region: "Western Province",
          country: "Sri Lanka",
          userAgent: "COOLWSD HTTP Agent 26.04.1.3",
        },
      ],
    },
    cloudflaredMessages: {
      total: 2,
      rows: [
        {
          timestamp: t[0],
          host: "ObsidianCloudflared",
          error: "failed to accept QUIC stream: timeout: no recent network activity",
        },
        {
          timestamp: t[3],
          host: "CloudflareConsult",
          error: "failed to connect to origin http://nextcloud.internal:80: dial timeout",
        },
      ],
    },
    idsAlerts: {
      total: 1394,
      rows: [
        {
          timestamp: t[0],
          sourceAddress: "10.0.1.50",
          userAgent: null,
          category: "Misc activity",
          signature: "ET INFO Observed Discord Domain (discord .com in TLS SNI)",
          destinationAddress: "162.159.137.232",
        },
        {
          timestamp: t[1],
          sourceAddress: "10.0.3.59",
          userAgent: null,
          category: "Misc activity",
          signature: "ET INFO DNS Query to Cloudflare Tunneling Domain (argotunnel .com)",
          destinationAddress: "10.0.3.1",
        },
        {
          timestamp: t[2],
          sourceAddress: "185.220.101.34",
          userAgent: "zgrab/0.x",
          category: "Attempted Information Leak",
          signature: "ET SCAN Suspicious inbound to mySQL port 3306",
          destinationAddress: "10.0.20.15",
        },
      ],
    },
    idsSsh: {
      total: 118,
      rows: [
        {
          timestamp: t[0],
          iface: "vlan0.1",
          clientSoftware: "OpenSSH_9.9",
          serverSoftware: "OpenSSH_10.3",
          sourceAddress: "10.0.1.50",
          destinationAddress: "10.0.1.1",
          direction: "internal",
        },
        {
          timestamp: t[2],
          iface: "vtnet0",
          clientSoftware: "libssh_0.11.0",
          serverSoftware: "OpenSSH_10.3",
          sourceAddress: "193.32.162.34",
          destinationAddress: "10.0.1.1",
          direction: "inbound",
        },
      ],
    },
    nextcloud: {
      total: 57,
      rows: [
        {
          timestamp: t[0],
          user: "PoofyFox",
          app: "admin_audit",
          message: 'Login successful: "PoofyFox"',
          remoteAddr: "10.0.3.59",
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/150.0.0.0",
          method: "GET",
          url: "/index.php/apps/dashboard/",
        },
        {
          timestamp: t[1],
          user: "demo",
          app: "files",
          message: "File accessed: /Photos/homelab-rack.jpg",
          remoteAddr: "10.0.1.42",
          userAgent: "Mozilla/5.0 (X11; Linux x86_64) Firefox/141.0",
          method: "GET",
          url: "/remote.php/dav/files/demo/Photos/homelab-rack.jpg",
        },
      ],
    },
    opnsenseWeb: {
      total: 812,
      rows: [
        {
          timestamp: t[0],
          sourceIp: "10.0.1.50",
          method: "GET",
          statusCode: "200",
          url: "/api/diagnostics/firewall/pf_statistics/rules",
          userAgent: "node",
          bytes: 48_555,
        },
        {
          timestamp: t[1],
          sourceIp: "10.0.1.42",
          method: "POST",
          statusCode: "200",
          url: "/api/core/firmware/status",
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/141.0",
          bytes: 1204,
        },
      ],
    },
    idsTls: {
      total: 9204,
      rows: [
        {
          timestamp: t[0],
          destinationAddress: "104.18.125.108",
          destinationPort: 443,
          organization: "Cloudflare, Inc.",
          protocol: "tls",
          direction: "outbound",
        },
        {
          timestamp: t[1],
          destinationAddress: "1.1.1.2",
          destinationPort: 853,
          organization: "Cloudflare, Inc.",
          protocol: "tls",
          direction: "outbound",
        },
        {
          timestamp: t[2],
          destinationAddress: "9.9.9.11",
          destinationPort: 853,
          organization: "Quad9",
          protocol: "tls",
          direction: "outbound",
        },
      ],
    },
    ids: {
      total: 2841,
      types: [
        { type: "alert", count: 1394 },
        { type: "http", count: 1355 },
        { type: "anomaly", count: 92 },
      ],
      rows: [
        {
          timestamp: t[0],
          eventType: "http",
          sourceAddress: "10.0.1.50",
          sourceOrg: null,
          anomalyEvent: null,
          destinationAddress: "10.0.3.16",
          transport: "tcp",
        },
        {
          timestamp: t[1],
          eventType: "anomaly",
          sourceAddress: "45.148.10.79",
          sourceOrg: "Hostkey B.V.",
          anomalyEvent: "APPLAYER_DETECT_PROTOCOL_ONLY_ONE_DIRECTION",
          destinationAddress: "10.0.1.1",
          transport: "tcp",
        },
        {
          timestamp: t[2],
          eventType: "alert",
          sourceAddress: "10.0.1.50",
          sourceOrg: null,
          anomalyEvent: null,
          destinationAddress: "10.0.1.1",
          transport: "udp",
        },
      ],
    },
  };
}

