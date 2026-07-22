#!/usr/bin/env node

import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

const DEFAULT_URL =
  "https://www.codefactor.io/repository/github/realynx/polysiem/issues/master";
const DEFAULT_OUTPUT_DIR = ".codex-tmp/codefactor";
const DEFAULT_MAX_PAGES = 500;
const REQUEST_TIMEOUT_MS = 30_000;

const USER_AGENTS = {
  normal:
    "PolySIEM-CodeFactor-Collector/1.0 (+https://github.com/Realynx/PolySIEM)",
  crawler:
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
};

const LOCATION_EXTENSION =
  "(?:tsx?|jsx?|mjs|cjs|css|scss|less|html?|vue|svelte|astro|json|ya?ml|md|sh|bash|ps1|py|rb|php|java|kt|kts|scala|go|rs|c|cc|cpp|cxx|h|hpp|cs|dart|r|sql|dockerfile)";
const LOCATION_WITH_LINES_RE = new RegExp(
  `([^\\n,]+?\\.${LOCATION_EXTENSION}):(\\d+)(?:-(\\d+))?`,
  "gi",
);
const DOCKERFILE_WITH_LINES_RE =
  /(?:^|\n)((?:[^\n,]*[\\/])?Dockerfile(?:\.[^:\n,]+)?):(\d+)(?:-(\d+))?/gi;
const LOCATION_ONLY_RE = new RegExp(
  `^(.*?\\.${LOCATION_EXTENSION})$`,
  "i",
);
const DOCKERFILE_ONLY_RE = /^(.*(?:^|[\\/])Dockerfile(?:\.[^:]+)?)$/i;
const SEVERITY_RE =
  /^(?:image:\s*)?severity:\s*(critical|major|minor|info|unknown)\s+(.+)$/i;
const SEVERITY_ONLY_RE =
  /^(?:image:\s*)?severity:\s*(critical|major|minor|info|unknown)\s*$/i;

function usage() {
  return `Collect every paginated CodeFactor issue and retain the source HTML.

Usage:
  npm run codefactor:collect -- [options]
  npm run codefactor:collect:browser -- <codefactor-issues-url>

Examples:
  npm run codefactor:collect:browser -- --url "https://www.codefactor.io/repository/github/OWNER/REPO/issues/BRANCH"
  Get-Clipboard | npm run codefactor:collect:browser -- --cookie-stdin --url "https://www.codefactor.io/repository/github/OWNER/REPO/issues/BRANCH"

Options:
  --url <url>          Issues URL without a page number
  --out <directory>    Output directory (default: ${DEFAULT_OUTPUT_DIR})
  --max-pages <count>  Safety limit (default: ${DEFAULT_MAX_PAGES})
  --delay-ms <ms>      Delay between pages (default: 250)
  --cookie <value>     CodeFactor Cookie header value (visible in shell history)
  --cookie-stdin       Read the Cookie header value from standard input
  --browser            Render pages with local headless Edge/Chrome
  --browser-path <exe> Override the Edge/Chrome executable path
  --allow-empty        Permit a verified zero-issue result
  --self-test          Test the HTML parser without network access
  --help               Show this help

If CodeFactor requires an authenticated session, use --cookie-stdin (preferred),
--cookie, or CODEFACTOR_COOKIE. An optional leading "Cookie:" is removed. The
cookie is sent only to https://www.codefactor.io and is never written to output.
Raw responses can still contain account or private-repository data. Unix mode
0600 is requested; Windows inherits the output directory's ACLs. Use a private
workspace, and do not commit or share the generated output.`;
}

const VALUE_OPTIONS = {
  "--url": (options, value) => { options.url = value; },
  "--out": (options, value) => { options.outDir = value; },
  "--max-pages": (options, value, option) => {
    options.maxPages = positiveInteger(value, option);
  },
  "--delay-ms": (options, value, option) => {
    options.delayMs = nonNegativeInteger(value, option);
  },
  "--cookie": (options, value) => { options.cookie = value; },
  "--browser-path": (options, value) => { options.browserPath = value; },
};

const FLAG_OPTIONS = {
  "--cookie-stdin": (options) => { options.cookieStdin = true; },
  "--browser": (options) => { options.browser = true; },
  "--allow-empty": (options) => { options.allowEmpty = true; },
  "--self-test": (options) => { options.selfTest = true; },
  "--help": (options) => { options.help = true; },
  "-h": (options) => { options.help = true; },
};

function optionValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

function parseArgs(argv) {
  const options = {
    url: DEFAULT_URL,
    outDir: DEFAULT_OUTPUT_DIR,
    maxPages: DEFAULT_MAX_PAGES,
    delayMs: 250,
    allowEmpty: false,
    cookie: null,
    cookieStdin: false,
    browser: false,
    browserPath: null,
    selfTest: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const valueOption = VALUE_OPTIONS[arg];
    if (valueOption) {
      valueOption(options, optionValue(argv, index, arg), arg);
      index += 1;
      continue;
    }
    const flagOption = FLAG_OPTIONS[arg];
    if (flagOption) {
      flagOption(options);
      continue;
    }
    if (!arg.startsWith("--") && /^https:\/\//i.test(arg)) {
      options.url = arg;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function positiveInteger(value, option) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${option} must be a positive integer`);
  }
  return parsed;
}

function nonNegativeInteger(value, option) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${option} must be a non-negative integer`);
  }
  return parsed;
}

function normalizeCookie(value) {
  const cookie = value?.trim().replace(/^cookie\s*:\s*/i, "") ?? "";
  if (!cookie) return null;
  if (/[\r\n]/.test(cookie)) {
    throw new Error("The CodeFactor cookie must not contain newlines");
  }
  return cookie;
}

async function readCookieFromStdin() {
  let value = "";
  for await (const chunk of process.stdin) value += chunk;
  return normalizeCookie(value);
}

function pageUrl(baseUrl, page) {
  const url = new URL(baseUrl);
  validateCodeFactorUrl(url);
  url.searchParams.set("page", String(page));
  return url;
}

function validateCodeFactorUrl(url) {
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "www.codefactor.io" ||
    !/^\/repository\/(?:github|bitbucket)\/[^/]+\/[^/]+\/issues(?:\/[^/]+)?\/?$/i.test(
      url.pathname,
    )
  ) {
    throw new Error(
      "--url must be an https://www.codefactor.io/repository/{provider}/{owner}/{repo}/issues[/branch] URL",
    );
  }
}

function decodeEntities(value) {
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    hellip: "…",
    laquo: "«",
    lt: "<",
    nbsp: " ",
    ndash: "–",
    quot: '"',
    raquo: "»",
  };

  return value.replace(
    /&(#x[\da-f]+|#\d+|[a-z][\da-z]+);/gi,
    (entity, code) => {
      if (code[0] !== "#") return named[code.toLowerCase()] ?? entity;
      const numeric = code[1].toLowerCase() === "x"
        ? Number.parseInt(code.slice(2), 16)
        : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : entity;
    },
  );
}

function attributeValue(tag, name) {
  const match = new RegExp(
    `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  ).exec(tag);
  return match ? decodeEntities(match[1] ?? match[2] ?? match[3] ?? "") : "";
}

export function htmlToLines(html) {
  const withoutNoise = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "\n")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "\n")
    .replace(/<img\b[^>]*>/gi, (tag) => {
      const alt = attributeValue(tag, "alt");
      const title = attributeValue(tag, "title");
      return `\n${alt || title}\n`;
    })
    .replace(/<(?:br|hr)\b[^>]*>/gi, "\n")
    .replace(
      /<\/?(?:article|aside|blockquote|dd|details|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|li|main|nav|ol|p|pre|section|summary|table|tbody|td|tfoot|th|thead|tr|ul)\b[^>]*>/gi,
      "\n",
    )
    .replace(/<[^>]+>/g, " ");

  return decodeEntities(withoutNoise)
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function cleanPath(path) {
  return path
    .replace(/^found in\s*/i, "")
    .replace(/^[,;:\s]+|[,;:\s]+$/g, "")
    .trim();
}

function locationKey(location) {
  return `${location.path.toLowerCase()}:${location.startLine ?? ""}:${location.endLine ?? ""}`;
}

function addLocation(locations, seen, location) {
  const key = locationKey(location);
  if (!location.path || seen.has(key)) return;
  seen.add(key);
  locations.push(location);
}

function locationsFromJoinedText(joined, pattern) {
  pattern.lastIndex = 0;
  return [...joined.matchAll(pattern)].map((match) => ({
    path: cleanPath(match[1]),
    startLine: Number(match[2]),
    endLine: match[3] ? Number(match[3]) : Number(match[2]),
  }));
}

function followingLineRange(lines, index) {
  for (const next of lines.slice(index + 1, index + 4)) {
    const range = /^(?::)?(\d+)(?:-(\d+))?\s*,?$/.exec(next);
    if (range) {
      const startLine = Number(range[1]);
      return { startLine, endLine: range[2] ? Number(range[2]) : startLine };
    }
  }
  return { startLine: null, endLine: null };
}

function splitLineLocations(lines) {
  return lines.flatMap((line, index) => {
    const candidatePath = cleanPath(line);
    const pathMatch = LOCATION_ONLY_RE.exec(candidatePath) ?? DOCKERFILE_ONLY_RE.exec(candidatePath);
    if (!pathMatch) return [];
    return [{ path: cleanPath(pathMatch[1]), ...followingLineRange(lines, index) }];
  });
}

export function extractLocations(lines) {
  const locations = [];
  const seen = new Set();
  const joined = lines.join("\n");
  const candidates = [
    ...locationsFromJoinedText(joined, LOCATION_WITH_LINES_RE),
    ...locationsFromJoinedText(joined, DOCKERFILE_WITH_LINES_RE),
    ...splitLineLocations(lines),
  ];
  for (const location of candidates) addLocation(locations, seen, location);

  return locations;
}

function splitRuleAndMetric(message) {
  const metric = /^(.*?)(?:\s+(complexity|lines of code)\s*=\s*(\d+))$/i.exec(message);
  return metric
    ? {
        rule: metric[1].trim(),
        metric: metric[2].toLowerCase(),
        metricValue: Number(metric[3]),
      }
    : { rule: message.trim(), metric: null, metricValue: null };
}

function issueRuleAndMetric(message, segment) {
  const parsed = splitRuleAndMetric(message);
  if (parsed.metric) return parsed;

  const metricLine = segment
    .map((line) => /^(complexity|lines of code)\s*=\s*(\d+)$/i.exec(line))
    .find(Boolean);
  return metricLine
    ? {
        ...parsed,
        metric: metricLine[1].toLowerCase(),
        metricValue: Number(metricLine[2]),
      }
    : parsed;
}

function stableIssueKey(issue) {
  return [
    issue.severity,
    issue.message,
    ...(issue.locations.length > 0
      ? issue.locations.map(locationKey).sort()
      : [issue.excerpt]),
  ].join("|").toLowerCase();
}

function issueKey(issue) {
  const stable = stableIssueKey(issue);
  return issue.locations.length > 0
    ? stable
    : `${stable}|page:${issue.page}|ordinal:${issue.ordinal}`;
}

export function extractIssues(html, page = 1) {
  const lines = htmlToLines(html);
  const starts = [];
  for (let index = 0; index < lines.length; index += 1) {
    const combined = SEVERITY_RE.exec(lines[index]);
    if (combined) {
      starts.push({ index, severity: combined[1], message: combined[2].trim() });
      continue;
    }

    const severityOnly = SEVERITY_ONLY_RE.exec(lines[index]);
    if (!severityOnly) continue;
    const message = lines
      .slice(index + 1, index + 5)
      .find((line) => !/^found in$/i.test(line) && !SEVERITY_ONLY_RE.test(line));
    if (message) starts.push({ index, severity: severityOnly[1], message });
  }

  return starts.map((start, issueIndex) => {
    const nextStart = starts[issueIndex + 1]?.index ?? lines.length;
    const segment = lines.slice(start.index, nextStart);
    const message = start.message;
    return {
      page,
      ordinal: issueIndex + 1,
      severity: start.severity.toLowerCase(),
      message,
      ...issueRuleAndMetric(message, segment),
      locations: extractLocations(segment),
      excerpt: segment.slice(0, 80).join("\n"),
    };
  });
}

function responseScore(html) {
  const issues = extractIssues(html);
  const foundIn = (html.match(/Found in/gi) ?? []).length;
  const placeholders = (html.match(/\{\{[^}]+\}\}/g) ?? []).length;
  return issues.length * 100 + foundIn * 10 - placeholders;
}

function isClientOnlyShell(html) {
  return (
    extractIssues(html).length === 0 &&
    /\{\{(?:::)?issue\.|ng-(?:app|controller|repeat)|getIssueFilterCount\(\)/i.test(html) &&
    !/\b0\s+issues\b/i.test(htmlToLines(html).join("\n"))
  );
}

function saysNoIssues(html) {
  return /\bNo issues found\b/i.test(htmlToLines(html).join("\n"));
}

function responseSaysNoIssues(response) {
  return response.rendered
    ? /\bNo issues found\b/i.test(response.visibleText ?? "")
    : saysNoIssues(response.html);
}

function declaredPageCount(html) {
  const candidates = [];
  const patterns = [
    /\bpage\s+\d+\s+(?:of|\/)\s*(\d+)\b/gi,
    /"PageCount"\s*:\s*(\d+)/gi,
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) candidates.push(Number(match[1]));
  }
  for (const line of htmlToLines(html)) {
    const fraction = /^(\d+)\s*\/\s*(\d+)$/.exec(line);
    if (fraction) candidates.push(Number(fraction[2]));
  }
  return candidates.length > 0 ? Math.max(...candidates) : null;
}

function declaredIssueTotal(response) {
  const text = response.rendered
    ? response.visibleText ?? ""
    : htmlToLines(response.html).join("\n");
  const candidates = [];
  for (const match of text.matchAll(/\b([\d,]+)\s+issues?\b/gi)) {
    candidates.push(Number(match[1].replaceAll(",", "")));
  }
  return candidates.length > 0 ? Math.max(...candidates) : null;
}

function assertSameInventory(requestedUrl, finalUrl) {
  if (!sameRenderedPage(requestedUrl, finalUrl)) {
    throw new Error(`GET ${requestedUrl} was redirected to a different CodeFactor inventory`);
  }
}

async function fetchHtml(url, userAgent, cookie, retries = 3) {
  validateCodeFactorUrl(new URL(url));
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: {
          accept: "text/html,application/xhtml+xml",
          "accept-language": "en-US,en;q=0.9",
          "cache-control": "no-cache",
          "user-agent": userAgent,
          ...(cookie ? { cookie } : {}),
        },
        redirect: "follow",
        signal: controller.signal,
      });
      const html = await response.text();
      if (!response.ok) {
        const error = new Error(
          `GET ${url} returned ${response.status} ${response.statusText}`,
        );
        error.status = response.status;
        error.bodyPreview = html.slice(0, 500);
        throw error;
      }
      const contentType = response.headers.get("content-type") ?? "";
      assertSameInventory(url, response.url);
      if (!contentType.toLowerCase().includes("text/html")) {
        throw new Error(`GET ${url} returned unexpected content-type ${contentType}`);
      }
      return { html, finalUrl: response.url, contentType };
    } catch (error) {
      lastError = error;
      const retryable =
        error.name === "AbortError" ||
        error.status === 429 ||
        (error.status >= 500 && error.status <= 599) ||
        error.cause?.code;
      if (!retryable || attempt === retries) throw error;
      await sleep(500 * 2 ** (attempt - 1));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

function sleep(milliseconds) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

async function fileExists(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function findBrowserExecutable(override) {
  if (override) {
    const absolute = resolve(override);
    if (await fileExists(absolute)) return absolute;
    throw new Error(`Browser executable not found: ${absolute}`);
  }

  const candidates = process.platform === "win32"
    ? [
        join(process.env.PROGRAMFILES ?? "", "Microsoft", "Edge", "Application", "msedge.exe"),
        join(process.env["PROGRAMFILES(X86)"] ?? "", "Microsoft", "Edge", "Application", "msedge.exe"),
        join(process.env.PROGRAMFILES ?? "", "Google", "Chrome", "Application", "chrome.exe"),
        join(process.env["PROGRAMFILES(X86)"] ?? "", "Google", "Chrome", "Application", "chrome.exe"),
        join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe"),
      ]
    : process.platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        ]
      : [
          "/usr/bin/google-chrome",
          "/usr/bin/google-chrome-stable",
          "/usr/bin/microsoft-edge",
          "/usr/bin/microsoft-edge-stable",
          "/usr/bin/chromium",
          "/usr/bin/chromium-browser",
        ];

  for (const candidate of candidates) {
    if (candidate && await fileExists(candidate)) return candidate;
  }
  throw new Error("No Edge/Chrome executable found; provide --browser-path <executable>");
}

function cookieRecords(cookie) {
  if (!cookie) return [];
  return cookie.split(";").flatMap((part) => {
    const separator = part.indexOf("=");
    if (separator <= 0) return [];
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    return name
      ? [{ name, value, url: "https://www.codefactor.io/", secure: true }]
      : [];
  });
}

class CdpConnection {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) {
        for (const listener of this.listeners.get(message.method) ?? []) {
          listener(message.params ?? {}, message.sessionId);
        }
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result ?? {});
    });
    socket.addEventListener("close", () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error("Browser debugging connection closed"));
      }
      this.pending.clear();
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolveOpen, rejectOpen) => {
      const timeout = setTimeout(
        () => rejectOpen(new Error("Timed out connecting to the browser debugger")),
        10_000,
      );
      socket.addEventListener("open", () => {
        clearTimeout(timeout);
        resolveOpen();
      }, { once: true });
      socket.addEventListener("error", () => {
        clearTimeout(timeout);
        rejectOpen(new Error("Unable to connect to the browser debugger"));
      }, { once: true });
    });
    return new CdpConnection(socket);
  }

  send(method, params = {}, sessionId = undefined) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolveCommand, rejectCommand) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        rejectCommand(new Error(`Browser command timed out: ${method}`));
      }, 30_000);
      this.pending.set(id, { resolve: resolveCommand, reject: rejectCommand, timeout });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? new Set();
    listeners.add(listener);
    this.listeners.set(method, listeners);
    return () => listeners.delete(listener);
  }

  close() {
    this.socket.close();
  }
}

async function browserDebuggerUrl(profileDir) {
  const activePortFile = join(profileDir, "DevToolsActivePort");
  let lastError;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const [portLine, pathLine] = (await readFile(activePortFile, "utf8")).trim().split(/\r?\n/);
      const port = Number(portLine);
      if (
        Number.isInteger(port) &&
        port > 0 &&
        port <= 65_535 &&
        pathLine?.startsWith("/devtools/browser/")
      ) {
        return `ws://127.0.0.1:${port}${pathLine}`;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw new Error(`Headless browser did not expose its debugger: ${lastError?.message ?? "timeout"}`);
}

function childLifecycle(processHandle) {
  let settled = false;
  let resolveExit;
  const exit = new Promise((resolveProcessExit) => {
    resolveExit = resolveProcessExit;
  });
  const failure = new Promise((_, rejectFailure) => {
    processHandle.once("error", (error) => {
      if (settled) return;
      settled = true;
      resolveExit({ error });
      rejectFailure(new Error(`Unable to launch headless browser: ${error.message}`));
    });
    processHandle.once("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      const result = { code, signal };
      resolveExit(result);
      rejectFailure(
        new Error(`Headless browser exited before connecting (code=${code}, signal=${signal})`),
      );
    });
  });
  return { exit, failure };
}

async function stopChildProcess(processHandle, exitPromise) {
  const exited = await Promise.race([
    exitPromise.then(() => true),
    sleep(3_000).then(() => false),
  ]);
  if (exited) return;
  processHandle.kill();
  await Promise.race([exitPromise, sleep(5_000)]);
}

function sameRenderedPage(requested, actual) {
  try {
    const requestedUrl = new URL(requested);
    const actualUrl = new URL(actual);
    validateCodeFactorUrl(requestedUrl);
    validateCodeFactorUrl(actualUrl);
    return inventoryIdentity(requestedUrl) === inventoryIdentity(actualUrl);
  } catch {
    return false;
  }
}

function inventoryIdentity(url) {
  const query = [...url.searchParams.entries()];
  if (!url.searchParams.has("page")) query.push(["page", "1"]);
  query.sort(([leftKey, leftValue], [rightKey, rightValue]) =>
    leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
  return [
    url.protocol.toLowerCase(),
    url.hostname.toLowerCase(),
    url.pathname.replace(/\/$/, "").toLowerCase(),
    JSON.stringify(query),
  ].join("|");
}

const RENDERED_DOCUMENT_EXPRESSION = `({
  html: document.documentElement?.outerHTML ?? "",
  visibleText: document.body?.innerText ?? "",
  finalUrl: location.href,
  readyState: document.readyState,
  timeOrigin: performance.timeOrigin
})`;

function networkFailureLabel(failure) {
  let requestPath = "CodeFactor request";
  try {
    const failedUrl = new URL(failure.url);
    requestPath = `${failedUrl.origin}${failedUrl.pathname}`;
  } catch {
    // Keep the generic label rather than echoing an untrusted URL.
  }
  const status = failure.status ? `HTTP ${failure.status}` : failure.error;
  return `${requestPath} (${status})`;
}

function freshRenderedDocument(latest, previousTimeOrigin, requestedUrl) {
  return Boolean(
    latest?.html &&
    latest.timeOrigin &&
    latest.timeOrigin !== previousTimeOrigin &&
    sameRenderedPage(requestedUrl, latest.finalUrl) &&
    latest.readyState === "complete",
  );
}

function stableRenderState() {
  return {
    latest: null,
    fingerprint: null,
    issuePolls: 0,
    noIssuePolls: 0,
    resolved: false,
  };
}

function updateStableRender(state, latest, elapsedMs) {
  state.latest = latest;
  const issues = extractIssues(latest.html);
  if (issues.length > 0) {
    const fingerprint = issues.map(stableIssueKey).sort().join("\n");
    state.issuePolls = fingerprint === state.fingerprint ? state.issuePolls + 1 : 1;
    state.fingerprint = fingerprint;
    state.noIssuePolls = 0;
    state.resolved = elapsedMs >= 5_000 && state.issuePolls >= 6;
    return;
  }

  state.fingerprint = null;
  state.issuePolls = 0;
  const visibleText = latest.visibleText ?? "";
  const terminal = /\bNo issues found\b/i.test(visibleText) && !/\{\{[^}]+\}\}/.test(visibleText);
  state.noIssuePolls = terminal ? state.noIssuePolls + 1 : 0;
  state.resolved = elapsedMs >= 5_000 && state.noIssuePolls >= 6;
}

class BrowserRenderer {
  constructor(processHandle, processExit, profileDir, cdp, sessionId) {
    this.processHandle = processHandle;
    this.processExit = processExit;
    this.profileDir = profileDir;
    this.cdp = cdp;
    this.sessionId = sessionId;
    this.inflightRequests = new Set();
    this.trackedRequests = new Map();
    this.failedRequests = [];
    this.lastNetworkActivity = Date.now();
    const requestFinished = ({ requestId }, eventSessionId) => {
      if (eventSessionId !== this.sessionId || !this.inflightRequests.delete(requestId)) return;
      this.trackedRequests.delete(requestId);
      this.lastNetworkActivity = Date.now();
    };
    this.removeNetworkListeners = [
      cdp.on("Network.requestWillBeSent", (params, eventSessionId) => {
        if (eventSessionId !== this.sessionId) return;
        const trackedType = ["Document", "XHR", "Fetch"].includes(params.type);
        let codeFactorRequest = false;
        try {
          const hostname = new URL(params.request?.url).hostname.toLowerCase();
          codeFactorRequest = hostname === "codefactor.io" || hostname.endsWith(".codefactor.io");
        } catch {
          // Ignore malformed/non-HTTP browser-internal requests.
        }
        if (!trackedType || !codeFactorRequest) return;
        this.inflightRequests.add(params.requestId);
        this.trackedRequests.set(params.requestId, {
          type: params.type,
          url: params.request.url,
        });
        this.lastNetworkActivity = Date.now();
      }),
      cdp.on("Network.responseReceived", (params, eventSessionId) => {
        if (eventSessionId !== this.sessionId) return;
        const request = this.trackedRequests.get(params.requestId);
        if (!request || params.response.status < 400) return;
        this.failedRequests.push({
          ...request,
          status: params.response.status,
          error: params.response.statusText || "HTTP error",
        });
      }),
      cdp.on("Network.loadingFinished", requestFinished),
      cdp.on("Network.loadingFailed", (params, eventSessionId) => {
        if (eventSessionId !== this.sessionId) return;
        const request = this.trackedRequests.get(params.requestId);
        if (request) {
          this.failedRequests.push({
            ...request,
            status: null,
            error: params.errorText || "Network request failed",
          });
        }
        requestFinished(params, eventSessionId);
      }),
    ];
  }

  static async launch(cookie, browserPath) {
    const executable = await findBrowserExecutable(browserPath);
    const profileDir = await mkdtemp(join(tmpdir(), "polysiem-codefactor-"));
    const processHandle = spawn(executable, [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-debugging-port=0",
      "--remote-debugging-address=127.0.0.1",
      `--user-data-dir=${profileDir}`,
      "about:blank",
    ], { stdio: "ignore", windowsHide: true });
    const lifecycle = childLifecycle(processHandle);

    try {
      const debuggerUrl = await Promise.race([
        browserDebuggerUrl(profileDir),
        lifecycle.failure,
      ]);
      const cdp = await CdpConnection.connect(debuggerUrl);
      const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await cdp.send("Target.attachToTarget", {
        targetId,
        flatten: true,
      });
      await cdp.send("Page.enable", {}, sessionId);
      await cdp.send("Runtime.enable", {}, sessionId);
      await cdp.send("Network.enable", {}, sessionId);
      await cdp.send("Network.setCacheDisabled", { cacheDisabled: true }, sessionId);
      const cookies = cookieRecords(cookie);
      if (cookies.length > 0) {
        await cdp.send("Network.setCookies", { cookies }, sessionId);
      }
      return new BrowserRenderer(processHandle, lifecycle.exit, profileDir, cdp, sessionId);
    } catch (error) {
      await stopChildProcess(processHandle, lifecycle.exit);
      try {
        await rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch {
        // Preserve the launch error; the OS can clean this isolated temp profile later.
      }
      throw error;
    }
  }

  resetNetworkTracking() {
    this.inflightRequests.clear();
    this.trackedRequests.clear();
    this.failedRequests = [];
    this.lastNetworkActivity = Date.now();
  }

  async currentDocument() {
    const evaluated = await this.cdp.send("Runtime.evaluate", {
      expression: RENDERED_DOCUMENT_EXPRESSION,
      returnByValue: true,
    }, this.sessionId);
    return evaluated.result?.value ?? null;
  }

  networkIsIdle() {
    return this.inflightRequests.size === 0 && Date.now() - this.lastNetworkActivity >= 1_500;
  }

  assertNetworkSucceeded() {
    if (this.failedRequests.length === 0) return;
    const failures = this.failedRequests.map(networkFailureLabel);
    throw new Error(`CodeFactor page data request failed: ${failures.join("; ")}`);
  }

  async waitForStableRender(url, previousTimeOrigin) {
    const startedAt = Date.now();
    const state = stableRenderState();
    while (Date.now() - startedAt < 30_000 && !state.resolved) {
      await sleep(500);
      const latest = await this.currentDocument();
      if (!freshRenderedDocument(latest, previousTimeOrigin, url)) continue;
      if (!this.networkIsIdle()) continue;
      this.assertNetworkSucceeded();
      updateStableRender(state, latest, Date.now() - startedAt);
    }
    return state;
  }

  async render(url) {
    this.resetNetworkTracking();
    const beforeNavigation = await this.cdp.send("Runtime.evaluate", {
      expression: "performance.timeOrigin",
      returnByValue: true,
    }, this.sessionId);
    const previousTimeOrigin = beforeNavigation.result?.value ?? null;
    await this.cdp.send("Page.navigate", { url: String(url) }, this.sessionId);
    const state = await this.waitForStableRender(url, previousTimeOrigin);
    const { latest, resolved, noIssuePolls } = state;
    if (!latest?.html) throw new Error(`Headless browser returned no DOM for ${url}`);
    if (!resolved) {
      throw new Error(
        `Headless browser did not reach a stable, hydrated issue list for ${url} within 30 seconds`,
      );
    }
    if (!sameRenderedPage(url, latest.finalUrl)) {
      throw new Error(`Headless browser was redirected away from ${url} to ${latest.finalUrl}`);
    }
    return {
      html: latest.html,
      visibleText: latest.visibleText ?? "",
      finalUrl: latest.finalUrl ?? String(url),
      contentType: "text/html; rendered=headless-browser",
      rendered: true,
      hydrated: true,
      terminal: noIssuePolls >= 6,
      name: "headless-browser",
    };
  }

  async close() {
    for (const removeListener of this.removeNetworkListeners) removeListener();
    try {
      await this.cdp.send("Network.clearBrowserCookies", {}, this.sessionId);
    } catch (error) {
      console.warn(`Could not clear temporary browser cookies: ${error.message}`);
    }
    try {
      await this.cdp.send("Browser.close");
    } catch {
      this.processHandle.kill();
    }
    this.cdp.close();
    await stopChildProcess(this.processHandle, this.processExit);
    try {
      await rm(this.profileDir, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      });
    } catch (error) {
      console.warn(`Could not remove temporary browser profile ${this.profileDir}: ${error.message}`);
    }
  }
}

async function writeJson(path, value) {
  await writePrivateText(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writePrivateText(path, contents) {
  await writeFile(path, contents, { encoding: "utf8", mode: 0o600 });
  try {
    await chmod(path, 0o600);
  } catch (error) {
    if (process.platform !== "win32") throw error;
  }
}

function markdownReport(result) {
  const lines = [
    "# CodeFactor issue inventory",
    "",
    `- Source: ${result.source}`,
    `- Collected: ${result.collectedAt}`,
    `- Pages fetched: ${result.pagesFetched}`,
    `- Issues: ${result.issues.length}`,
    `- Stop reason: ${result.stopReason}`,
    "",
  ];

  for (const [index, issue] of result.issues.entries()) {
    lines.push(
      `## ${index + 1}. ${issue.rule}`,
      "",
      `- Severity: ${issue.severity}`,
      `- Page: ${issue.page}`,
    );
    if (issue.metric) lines.push(`- ${issue.metric}: ${issue.metricValue}`);
    if (issue.locations.length === 0) {
      lines.push("- Location: not present in the returned HTML");
    } else {
      for (const location of issue.locations) {
        const range = location.startLine
          ? `:${location.startLine}${location.endLine !== location.startLine ? `-${location.endLine}` : ""}`
          : "";
        lines.push(`- Location: \`${location.path}${range}\``);
      }
    }
    lines.push("", issue.message, "");
  }

  return `${lines.join("\n")}\n`;
}

async function selectFirstPage(url, cookie) {
  const candidates = [];
  const failures = [];
  for (const [name, userAgent] of Object.entries(USER_AGENTS)) {
    try {
      const response = await fetchHtml(url, userAgent, cookie);
      candidates.push({ name, userAgent, ...response, score: responseScore(response.html) });
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
    }
  }
  if (candidates.length === 0) {
    throw new AggregateError(
      failures.map((message) => new Error(message)),
      `Every CodeFactor response profile failed (${failures.join("; ")})`,
    );
  }
  candidates.sort((left, right) => right.score - left.score);
  return candidates[0];
}

function createCollectionState(options, cookie, outDir) {
  const baseUrl = new URL(options.url);
  return {
    options,
    cookie,
    outDir,
    pageRecords: [],
    issues: [],
    seenIssues: new Set(),
    selectedAgent: null,
    stopReason: null,
    previousFingerprint: null,
    declaredPages: null,
    declaredIssues: null,
    browserRenderer: null,
    unfilteredInventory: [...baseUrl.searchParams.keys()].every((key) => key === "page"),
  };
}

async function initializeCollectionTransport(state) {
  if (!state.options.browser) return;
  state.browserRenderer = await BrowserRenderer.launch(state.cookie, state.options.browserPath);
  state.selectedAgent = { name: "headless-browser" };
}

async function fetchCollectionPage(state, page, url) {
  if (state.browserRenderer) return state.browserRenderer.render(url);
  if (page === 1) {
    const response = await selectFirstPage(url, state.cookie);
    state.selectedAgent = response;
    return response;
  }
  return {
    ...(await fetchHtml(url, state.selectedAgent.userAgent, state.cookie)),
    name: state.selectedAgent.name,
    userAgent: state.selectedAgent.userAgent,
  };
}

function updateDeclaredInventory(state, response) {
  const pageCount = declaredPageCount(response.html);
  if (pageCount) state.declaredPages = Math.max(state.declaredPages ?? 0, pageCount);
  const issueTotal = declaredIssueTotal(response);
  if (issueTotal !== null) {
    state.declaredIssues = Math.max(state.declaredIssues ?? 0, issueTotal);
  }
}

function validateCollectedPage(response, page, fingerprint, previousFingerprint) {
  if (!response.rendered && isClientOnlyShell(response.html)) {
    throw new Error(
      `CodeFactor returned only its client-rendered Angular shell on page ${page}. Raw HTML was saved, but accepting it would truncate the issue inventory. Supply an authenticated cookie or use a browser-rendered export.`,
    );
  }
  if (response.rendered && !response.hydrated) {
    throw new Error(`Headless browser did not prove that page ${page} was hydrated`);
  }
  if (page > 1 && fingerprint && fingerprint === previousFingerprint) {
    throw new Error(
      `Page ${page} repeated page ${page - 1}; CodeFactor may have ignored the page query. Pagination completeness cannot be proven.`,
    );
  }
}

function appendUniqueIssues(state, pageIssues) {
  for (const issue of pageIssues) {
    const key = issueKey(issue);
    if (state.seenIssues.has(key)) continue;
    state.seenIssues.add(key);
    state.issues.push(issue);
  }
}

function paginationStopReason(state, page, response, pageIssues) {
  if (state.declaredPages && page >= state.declaredPages) {
    return `reached declared page count (${state.declaredPages})`;
  }
  const verifiedEmpty =
    pageIssues.length === 0 &&
    responseSaysNoIssues(response) &&
    (!response.rendered || response.terminal);
  if (verifiedEmpty) {
    return page === 1 ? "CodeFactor reported no issues" : `page ${page} reported no issues`;
  }
  if (pageIssues.length === 0) {
    throw new Error(
      `Page ${page} contained neither extractable issues nor a verified "No issues found" marker. Inspect page-${String(page).padStart(4, "0")}.html.`,
    );
  }
  return null;
}

function pageRecord(page, url, response, issueCount) {
  return {
    page,
    requestedUrl: String(url),
    finalUrl: response.finalUrl,
    bytes: Buffer.byteLength(response.html),
    extractedIssues: issueCount,
    rendered: response.rendered === true,
    hydrated: response.hydrated === true,
    terminal: response.terminal === true,
    clientOnlyShell: !response.rendered && isClientOnlyShell(response.html),
    saysNoIssues: responseSaysNoIssues(response),
  };
}

async function processCollectionPage(state, page, url, response) {
  const rawPath = resolve(state.outDir, `page-${String(page).padStart(4, "0")}.html`);
  await writePrivateText(rawPath, response.html);
  const pageIssues = extractIssues(response.html, page);
  const fingerprint = pageIssues.map(stableIssueKey).sort().join("\n");
  updateDeclaredInventory(state, response);
  state.pageRecords.push(pageRecord(page, url, response, pageIssues.length));
  validateCollectedPage(response, page, fingerprint, state.previousFingerprint);
  appendUniqueIssues(state, pageIssues);
  const stopReason = paginationStopReason(state, page, response, pageIssues);
  state.previousFingerprint = fingerprint;
  return stopReason;
}

async function collectPages(state) {
  for (let page = 1; page <= state.options.maxPages; page += 1) {
    const url = pageUrl(state.options.url, page);
    const response = await fetchCollectionPage(state, page, url);
    state.stopReason = await processCollectionPage(state, page, url, response);
    if (state.stopReason) return;
    if (state.options.delayMs > 0) await sleep(state.options.delayMs);
  }
}

function assertCompleteCollection(state) {
  if (!state.stopReason) {
    throw new Error(`Reached --max-pages=${state.options.maxPages} before pagination ended`);
  }
  const totalMismatch =
    state.unfilteredInventory &&
    state.declaredIssues !== null &&
    state.issues.length !== state.declaredIssues;
  if (totalMismatch) {
    throw new Error(
      `Extracted ${state.issues.length} issues, but CodeFactor displays ${state.declaredIssues}. The inventory would be incomplete.`,
    );
  }
  if (state.issues.length === 0 && !state.options.allowEmpty) {
    throw new Error(
      "The collector found zero issues. Re-run with --allow-empty only after verifying the CodeFactor page genuinely has no issues.",
    );
  }
}

function collectionResult(state) {
  return {
    source: state.options.url,
    collectedAt: new Date().toISOString(),
    selectedResponseProfile: state.selectedAgent.name,
    pagesFetched: state.pageRecords.length,
    declaredPages: state.declaredPages,
    declaredIssues: state.declaredIssues,
    stopReason: state.stopReason,
    pages: state.pageRecords,
    issues: state.issues,
  };
}

async function persistCollectionResult(state, result) {
  await writeJson(resolve(state.outDir, "issues.json"), result);
  await writePrivateText(resolve(state.outDir, "issues.md"), markdownReport(result));
  await writeJson(resolve(state.outDir, "run.json"), { ok: true, ...result, issues: undefined });
}

async function persistCollectionFailure(state, error) {
  await writeJson(resolve(state.outDir, "run.json"), {
    ok: false,
    source: state.options.url,
    failedAt: new Date().toISOString(),
    error: error.message,
    status: error.status,
    bodyPreview: error.bodyPreview,
    selectedResponseProfile: state.selectedAgent?.name,
    pages: state.pageRecords,
  });
}

async function closeCollectionTransport(state) {
  if (!state.browserRenderer) return;
  try {
    await state.browserRenderer.close();
  } catch (error) {
    console.warn(`Headless browser cleanup failed: ${error.message}`);
  }
}

async function clearPreviousCollectionOutput(outDir) {
  const generatedName = /^(?:issues\.(?:json|md)|run\.json|page-\d{4}\.html)$/;
  const entries = await readdir(outDir, { withFileTypes: true });
  await Promise.all(entries
    .filter((entry) => entry.isFile() && generatedName.test(entry.name))
    .map((entry) => rm(resolve(outDir, entry.name), { force: true })));
}

export async function collectCodeFactorIssues(options) {
  validateCodeFactorUrl(new URL(options.url));
  const cookie = normalizeCookie(options.cookie ?? process.env.CODEFACTOR_COOKIE);
  const outDir = resolve(options.outDir);
  await mkdir(outDir, { recursive: true, mode: 0o700 });
  if (cookie) {
    console.warn(
      `An authenticated CodeFactor cookie is set. Raw responses will be stored privately in ${outDir}.`,
    );
  }
  const state = createCollectionState(options, cookie, outDir);

  try {
    await clearPreviousCollectionOutput(outDir);
    await initializeCollectionTransport(state);
    await collectPages(state);
    assertCompleteCollection(state);
    const result = collectionResult(state);
    await persistCollectionResult(state, result);
    return result;
  } catch (error) {
    await persistCollectionFailure(state, error);
    throw error;
  } finally {
    await closeCollectionTransport(state);
  }
}

export function selfTest() {
  assert.equal(normalizeCookie("Cookie: session=abc; theme=dark"), "session=abc; theme=dark");
  assert.equal(normalizeCookie("  session=abc  "), "session=abc");
  assert.throws(() => normalizeCookie("session=abc\r\nX-Test: injected"));
  assert.equal(
    parseArgs([
      "https://www.codefactor.io/repository/github/example/positional/issues/main?page=1",
    ]).url,
    "https://www.codefactor.io/repository/github/example/positional/issues/main?page=1",
  );
  assert.deepEqual(cookieRecords("first=a=b; second=c"), [
    { name: "first", value: "a=b", url: "https://www.codefactor.io/", secure: true },
    { name: "second", value: "c", url: "https://www.codefactor.io/", secure: true },
  ]);
  assert.equal(
    sameRenderedPage(
      `${DEFAULT_URL}?page=1`,
      DEFAULT_URL,
    ),
    true,
  );
  assert.equal(
    sameRenderedPage(
      `${DEFAULT_URL}?severity=major&category=complexity&page=1`,
      `${DEFAULT_URL}?category=complexity&page=1&severity=major`,
    ),
    true,
  );
  assert.equal(
    sameRenderedPage(
      `${DEFAULT_URL}?severity=major&page=1`,
      `${DEFAULT_URL}?page=1`,
    ),
    false,
  );
  assert.equal(
    sameRenderedPage(
      `${DEFAULT_URL}?page=1`,
      "https://www.codefactor.io/repository/github/example/another-repo/issues/master?page=1",
    ),
    false,
  );
  assert.equal(isClientOnlyShell("<main>{{issue.title}}</main>"), true);
  assert.equal(responseSaysNoIssues({ rendered: true, visibleText: "No issues found" }), true);
  assert.equal(declaredPageCount("<span>Page 1 of 14</span>"), 14);
  assert.equal(
    declaredIssueTotal({ rendered: true, visibleText: "134 issues" }),
    134,
  );
  assert.equal(
    sameRenderedPage(
      `${DEFAULT_URL}?page=2`,
      `${DEFAULT_URL}?page=1`,
    ),
    false,
  );
  assert.equal(
    sameRenderedPage(
      "https://www.codefactor.io/repository/github/example/another-repo/issues/main?page=3",
      "https://www.codefactor.io/repository/github/example/another-repo/issues/main?page=3",
    ),
    true,
  );

  const fixture = `
    <main>
      <article>
        <img alt="Severity: Major"><h3>Very Complex Method</h3>
        <div>complexity = 42</div>
        <p>Found in</p>
        <div>src\\routing.ts:10-90 ,</div>
      </article>
      <article>
        <img alt="Severity: Minor"><h3>Duplicate Code lines of code = 24</h3>
        <p>Found in</p>
        <div>src/a.ts:3-26 ,</div>
        <div>src/b.ts</div><div>:8-31</div>
        <div>deploy/Dockerfile:12-20</div>
      </article>
    </main>`;
  const issues = extractIssues(fixture, 7);
  assert.equal(issues.length, 2);
  assert.deepEqual(
    {
      page: issues[0].page,
      severity: issues[0].severity,
      rule: issues[0].rule,
      metric: issues[0].metric,
      metricValue: issues[0].metricValue,
      locations: issues[0].locations,
    },
    {
      page: 7,
      severity: "major",
      rule: "Very Complex Method",
      metric: "complexity",
      metricValue: 42,
      locations: [{ path: "src\\routing.ts", startLine: 10, endLine: 90 }],
    },
  );
  assert.deepEqual(issues[1].locations, [
    { path: "src/a.ts", startLine: 3, endLine: 26 },
    { path: "deploy/Dockerfile", startLine: 12, endLine: 20 },
    { path: "src/b.ts", startLine: 8, endLine: 31 },
  ]);
  return true;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (options.selfTest) {
    selfTest();
    console.log("CodeFactor collector parser self-test passed.");
    return;
  }

  if (options.cookie && options.cookieStdin) {
    throw new Error("Use only one of --cookie or --cookie-stdin");
  }
  if (!options.cookie && !options.cookieStdin && !process.stdin.isTTY) {
    options.cookieStdin = true;
  }
  if (options.cookieStdin) options.cookie = await readCookieFromStdin();

  const result = await collectCodeFactorIssues(options);
  console.log(
    `Collected ${result.issues.length} issues from ${result.pagesFetched} pages into ${resolve(options.outDir)}`,
  );
}

const isMain = process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((error) => {
    console.error(`CodeFactor collection failed: ${error.message}`);
    process.exitCode = 1;
  });
}
