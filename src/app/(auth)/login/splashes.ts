/**
 * Minecraft-style splash lines for the login page. One is picked at
 * random per request. Keep entries short (~28 chars) so the tilted
 * splash doesn't run off small screens.
 */
export const splashes = [
  "Also try documentation!",
  "It's always DNS!",
  "Now with 100% more uptime!",
  "Works on my machine!",
  "RAID is not a backup!",
  "Self-hosted and proud!",
  "As seen on r/homelab!",
  "sudo make me a sandwich!",
  "127.0.0.1 sweet 127.0.0.1!",
  "Blinkenlights included!",
  "Tail your logs!",
  "Don't feed the port scanners!",
  "May contain traces of YAML!",
  "VLANs for everything!",
  "99 little bugs in the code...",
  "Segfault-free since reboot!",
  "Zero trust, full heart!",
  "Hug your sysadmin!",
  "Fans go brrrr!",
  "Single pane of glass!",
  "Powered by cron and hope!",
  "chmod 777 is not a fix!",
  "Certified fox-friendly!",
  "Have you tried rebooting?",
  "Encrypted at rest!",
  "Ping me maybe?",
  "Firewall rules, literally!",
  "The cloud is someone's homelab!",
  "Cable management pending...",
  "Free as in root access!",
];

export function randomSplash(): string {
  return splashes[Math.floor(Math.random() * splashes.length)];
}
