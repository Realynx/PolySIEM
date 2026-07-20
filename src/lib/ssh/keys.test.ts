import { describe, expect, it } from "vitest";
import {
  buildInstallScripts,
  fingerprintSha256,
  generateEd25519Keypair,
  keyBits,
  parseAuthorizedKeys,
  parsePublicKey,
  SshKeyParseError,
} from "./keys";

// Real keys generated with OpenSSH; fingerprints confirmed via `ssh-keygen -lf`.
const ED25519 =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPo0FjC01igM73mFhsHpTjRZfrdlGJaDQAvA/iLRrjLP fox@test-ed";
const ED25519_FP = "SHA256:Suoxnp94it0qUWl/L+GrOJmMVof5tlMni1QDQUL5Dxw";

const RSA_3072 =
  "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQC7t7Er2hIIUqH7wTH09+jQ24Axb3LLfbH3STZQcOJS5Kjs53X3HF1uFN0VU+xSZhtB07hoeMHhutgyb7IfPRofYAW/IanGrptXB5sJFmFmnCJFC1sSU9jEeZqNBVn8M/cA5l/iootfqNYLaQ8YgVZm/r/sk/vUFhYuR1S0u3j7s/qBm14KgdfHmNg369wzX5XwE9gAwfct/f9dMGnMX6UrQuqvRzea8Mg8dnm04Ge8NOZi6y1Zbicl3SlWPG++jHHiB9QeeCVSKaejmQt58xZaEeQYY/PkNBnER3n8nZsSTR0lSBsp/9cDlLNnmm06DUWgsy+r8WEs6ZeuRfHYutoocC75FyzQZrXRi0887eHYThtC+YS3FSU55Fv3wXOqnETplVVuXRppdFlmPzycstBrSrftKx/zp1PejWapVND0aRz3GbXzYJJ3iCcLwThLE972ozn4E7Pqvr5uD9nMxbEmq70XzneiFoc7VHkJkSH/Pm26/Ef7CWRymXEIjS87H1c= fox@test-rsa";
const RSA_FP = "SHA256:nGjlkAsx1Pj9m7nbjICG99BsZCiwlD08wnlIfBClUKk";

const ECDSA_256 =
  "ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBDrQkLq4Sh9qUfPrjbFu6dexlFoRa9ITmKAGrsX9fPsCWcq62SbNvLYDBCKe2/1dUTs+dzuhm6g3nefzjiyMG0o= fox@test-ec";
const ECDSA_FP = "SHA256:tfS76JaTX1Tyi2U4M5KocAa0s1TAm11kqSzR/U7ebJ8";

describe("parsePublicKey", () => {
  it("parses an ed25519 key with comment", () => {
    const key = parsePublicKey(ED25519);
    expect(key.keyType).toBe("ssh-ed25519");
    expect(key.comment).toBe("fox@test-ed");
    expect(key.fingerprint).toBe(ED25519_FP);
    expect(key.bits).toBe(256);
    expect(key.line).toBe(ED25519);
  });

  it("parses an RSA key and reports modulus bits", () => {
    const key = parsePublicKey(RSA_3072);
    expect(key.keyType).toBe("ssh-rsa");
    expect(key.fingerprint).toBe(RSA_FP);
    expect(key.bits).toBe(3072);
  });

  it("parses an ECDSA key with curve bits", () => {
    const key = parsePublicKey(ECDSA_256);
    expect(key.keyType).toBe("ecdsa-sha2-nistp256");
    expect(key.fingerprint).toBe(ECDSA_FP);
    expect(key.bits).toBe(256);
  });

  it("parses a key without a comment", () => {
    const noComment = ED25519.split(" ").slice(0, 2).join(" ");
    const key = parsePublicKey(noComment);
    expect(key.comment).toBeNull();
    expect(key.fingerprint).toBe(ED25519_FP);
  });

  it("strips an authorized_keys options prefix (quoted commas and spaces)", () => {
    const key = parsePublicKey(
      `command="rsync --server -a . /backup",no-pty,no-agent-forwarding ${ED25519}`,
    );
    expect(key.keyType).toBe("ssh-ed25519");
    expect(key.fingerprint).toBe(ED25519_FP);
    expect(key.comment).toBe("fox@test-ed");
    expect(key.line).toBe(ED25519); // canonical form drops the options
  });

  it("keeps multi-word comments", () => {
    const key = parsePublicKey(`${ED25519.split(" ").slice(0, 2).join(" ")} fox laptop key`);
    expect(key.comment).toBe("fox laptop key");
  });

  it("rejects private key material with a specific code", () => {
    const attempt = () =>
      parsePublicKey("-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjE...");
    expect(attempt).toThrowError(SshKeyParseError);
    try {
      attempt();
    } catch (err) {
      expect((err as SshKeyParseError).code).toBe("private_key");
    }
  });

  it("rejects RSA PEM private keys too", () => {
    try {
      parsePublicKey("-----BEGIN RSA PRIVATE KEY-----");
      expect.unreachable();
    } catch (err) {
      expect((err as SshKeyParseError).code).toBe("private_key");
    }
  });

  it("rejects unknown key types", () => {
    try {
      parsePublicKey("ssh-quantum AAAA fox@nowhere");
      expect.unreachable();
    } catch (err) {
      expect((err as SshKeyParseError).code).toBe("unknown_type");
    }
  });

  it("rejects invalid base64 blobs", () => {
    try {
      parsePublicKey("ssh-ed25519 not!!!base64 fox");
      expect.unreachable();
    } catch (err) {
      expect((err as SshKeyParseError).code).toBe("bad_base64");
    }
  });

  it("rejects a blob whose embedded type disagrees with the declared type", () => {
    const blob = ED25519.split(" ")[1];
    try {
      parsePublicKey(`ssh-rsa ${blob} liar`);
      expect.unreachable();
    } catch (err) {
      expect((err as SshKeyParseError).code).toBe("type_mismatch");
    }
  });

  it("rejects truncated blobs instead of crashing", () => {
    try {
      parsePublicKey("ssh-ed25519 AAAAC3Nz");
      expect.unreachable();
    } catch (err) {
      expect((err as SshKeyParseError).code).toBe("bad_base64");
    }
  });
});

describe("fingerprintSha256 / keyBits", () => {
  it("matches ssh-keygen -lf output for all fixture keys", () => {
    expect(fingerprintSha256(ED25519.split(" ")[1])).toBe(ED25519_FP);
    expect(fingerprintSha256(RSA_3072.split(" ")[1])).toBe(RSA_FP);
    expect(fingerprintSha256(ECDSA_256.split(" ")[1])).toBe(ECDSA_FP);
  });

  it("reports bits per type", () => {
    expect(keyBits("ssh-ed25519", ED25519.split(" ")[1])).toBe(256);
    expect(keyBits("ssh-rsa", RSA_3072.split(" ")[1])).toBe(3072);
    expect(keyBits("ecdsa-sha2-nistp384", "")).toBe(384);
    expect(keyBits("ecdsa-sha2-nistp521", "")).toBe(521);
  });
});

describe("parseAuthorizedKeys", () => {
  it("parses multiple lines, skipping blanks and comments", () => {
    const text = `# my keys\n\n${ED25519}\n${RSA_3072}\n`;
    const results = parseAuthorizedKeys(text);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it("reports bad lines with line numbers without dropping good ones", () => {
    const text = `${ED25519}\ngarbage line here\n${ECDSA_256}`;
    const results = parseAuthorizedKeys(text);
    expect(results).toHaveLength(3);
    expect(results[0].ok).toBe(true);
    expect(results[1]).toMatchObject({ ok: false, lineNumber: 2, code: "unknown_type" });
    expect(results[2].ok).toBe(true);
  });

  it("flags pasted private keys per line", () => {
    const results = parseAuthorizedKeys("-----BEGIN OPENSSH PRIVATE KEY-----");
    expect(results[0]).toMatchObject({ ok: false, code: "private_key" });
  });

  it("handles CRLF input", () => {
    const results = parseAuthorizedKeys(`${ED25519}\r\n${RSA_3072}\r\n`);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.ok)).toBe(true);
  });
});

describe("generateEd25519Keypair", () => {
  it("produces a parseable public line with the comment", () => {
    const pair = generateEd25519Keypair("polysiem@homelab");
    const parsed = parsePublicKey(pair.publicKeyLine);
    expect(parsed.keyType).toBe("ssh-ed25519");
    expect(parsed.comment).toBe("polysiem@homelab");
    expect(parsed.bits).toBe(256);
    expect(parsed.fingerprint).toBe(pair.fingerprint);
  });

  it("serializes an openssh-key-v1 private key whose embedded key matches the public line", () => {
    const pair = generateEd25519Keypair("roundtrip@test");
    const pemBody = pair.privateKeyPem
      .replace("-----BEGIN OPENSSH PRIVATE KEY-----", "")
      .replace("-----END OPENSSH PRIVATE KEY-----", "")
      .replace(/\s+/g, "");
    const body = Buffer.from(pemBody, "base64");

    // magic
    const magic = "openssh-key-v1\0";
    expect(body.subarray(0, magic.length).toString("latin1")).toBe(magic);

    const readString = (offset: number) => {
      const len = body.readUInt32BE(offset);
      return { value: body.subarray(offset + 4, offset + 4 + len), next: offset + 4 + len };
    };
    let cursor = readString(magic.length); // cipher
    expect(cursor.value.toString()).toBe("none");
    cursor = readString(cursor.next); // kdf
    expect(cursor.value.toString()).toBe("none");
    cursor = readString(cursor.next); // kdf options
    expect(body.readUInt32BE(cursor.next)).toBe(1); // key count
    cursor = readString(cursor.next + 4); // public blob
    const publicBlob = cursor.value;
    expect(publicBlob.toString("base64")).toBe(pair.publicKeyLine.split(" ")[1]);

    // Private section: checkint ×2, then keytype/pub/priv/comment + 1,2,3… padding.
    const priv = readString(cursor.next).value;
    expect(priv.length % 8).toBe(0);
    expect(priv.readUInt32BE(0)).toBe(priv.readUInt32BE(4));
    const p = 8;
    const readPrivString = (offset: number) => {
      const len = priv.readUInt32BE(offset);
      return { value: priv.subarray(offset + 4, offset + 4 + len), next: offset + 4 + len };
    };
    let field = readPrivString(p);
    expect(field.value.toString()).toBe("ssh-ed25519");
    field = readPrivString(field.next); // pub (32 bytes)
    const pub = field.value;
    expect(pub.length).toBe(32);
    field = readPrivString(field.next); // seed||pub (64 bytes)
    expect(field.value.length).toBe(64);
    expect(field.value.subarray(32).equals(pub)).toBe(true);
    field = readPrivString(field.next); // comment
    expect(field.value.toString()).toBe("roundtrip@test");
    // padding bytes count up from 1
    const padding = priv.subarray(field.next);
    padding.forEach((byte, i) => expect(byte).toBe(i + 1));
  });

  it("generates unique keys and fingerprints", () => {
    const a = generateEd25519Keypair("a");
    const b = generateEd25519Keypair("b");
    expect(a.fingerprint).not.toBe(b.fingerprint);
    expect(a.publicKeyLine).not.toBe(b.publicKeyLine);
  });

  it("omits the trailing space when the comment is empty", () => {
    const pair = generateEd25519Keypair("");
    expect(pair.publicKeyLine.endsWith(" ")).toBe(false);
    expect(pair.publicKeyLine.split(" ")).toHaveLength(2);
  });
});

describe("buildInstallScripts", () => {
  it("embeds the key and username in the bash script with an idempotency guard", () => {
    const { bash } = buildInstallScripts(ED25519, "fox");
    expect(bash).toContain(`KEY='${ED25519}'`);
    expect(bash).toContain('user "fox"');
    expect(bash).toContain("grep -qxF");
    expect(bash).toContain("chmod 700");
    expect(bash).toContain("chmod 600");
  });

  it("escapes single quotes in comments for both shells", () => {
    const tricky = `${ED25519.split(" ").slice(0, 2).join(" ")} fox's key`;
    const { bash, powershell } = buildInstallScripts(tricky);
    expect(bash).toContain("fox'\\''s key");
    expect(powershell).toContain("fox''s key");
  });

  it("mentions the administrators_authorized_keys caveat in the PowerShell script", () => {
    const { powershell } = buildInstallScripts(ED25519, "Administrator");
    expect(powershell).toContain("administrators_authorized_keys");
    expect(powershell).toContain("Add-Content");
  });
});
