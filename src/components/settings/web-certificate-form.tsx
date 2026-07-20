"use client";

import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { FileUp, RefreshCw, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/components/shared/api-client";

interface WebCertificateInfoView {
  commonName: string;
  subject: string;
  issuer: string;
  selfSigned: boolean;
  altNames: string[];
  notBefore: string;
  notAfter: string;
  fingerprint256: string;
}

export interface WebCertificateFormInitial {
  source: "self-signed" | "uploaded" | null;
  updatedAt: string | null;
  info: WebCertificateInfoView | null;
  suggestedAltNames: string[];
}

function daysUntil(iso: string): number {
  return Math.floor((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

function ExpiryBadge({ notAfter }: { notAfter: string }) {
  const days = daysUntil(notAfter);
  if (days < 0) return <Badge variant="destructive">Expired</Badge>;
  if (days <= 30) {
    return (
      <Badge variant="outline" className="border-warning/50 text-warning">
        Expires in {days} day{days === 1 ? "" : "s"}
      </Badge>
    );
  }
  return null;
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[10rem_1fr] sm:gap-3">
      <p className="text-sm text-muted-foreground">{label}</p>
      <div className="min-w-0 text-sm">{children}</div>
    </div>
  );
}

export function WebCertificateForm({ initial }: { initial: WebCertificateFormInitial }) {
  const router = useRouter();
  const { info } = initial;

  const [hostnames, setHostnames] = useState(initial.suggestedAltNames.join("\n"));
  const [days, setDays] = useState("3650");
  const [certPem, setCertPem] = useState("");
  const [keyPem, setKeyPem] = useState("");
  const certFileRef = useRef<HTMLInputElement>(null);
  const keyFileRef = useRef<HTMLInputElement>(null);

  const applyToast = (applied: boolean, message: string) =>
    applied
      ? toast.success(`${message} It is live now — reload over https to pick it up.`)
      : toast.warning(`${message} It will be served after the next restart.`);

  const generate = useMutation({
    mutationFn: () => {
      const altNames = hostnames
        .split(/[\n,]/)
        .map((h) => h.trim())
        .filter(Boolean);
      const parsedDays = Number.parseInt(days, 10);
      return apiFetch<{ applied: boolean }>("/api/admin/web-certificate/generate", {
        method: "POST",
        body: JSON.stringify({
          ...(altNames.length > 0 ? { altNames } : {}),
          ...(Number.isFinite(parsedDays) ? { days: parsedDays } : {}),
        }),
      });
    },
    onSuccess: ({ applied }) => {
      applyToast(applied, "Self-signed certificate generated.");
      router.refresh();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const upload = useMutation({
    mutationFn: () =>
      apiFetch<{ applied: boolean }>("/api/admin/web-certificate", {
        method: "PUT",
        body: JSON.stringify({ certPem, keyPem }),
      }),
    onSuccess: ({ applied }) => {
      applyToast(applied, "Certificate uploaded.");
      setCertPem("");
      setKeyPem("");
      if (certFileRef.current) certFileRef.current.value = "";
      if (keyFileRef.current) keyFileRef.current.value = "";
      router.refresh();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const readFileInto = (setter: (text: string) => void) => async (file: File | undefined) => {
    if (!file) return;
    setter((await file.text()).trim());
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" />
            Current certificate
          </CardTitle>
          <CardDescription>
            PolySIEM serves HTTPS with this certificate. Changes below apply within a few
            seconds — no restart needed. Running behind your own reverse proxy? Disable the
            built-in TLS with <code className="font-mono text-xs">POLYSIEM_TLS=off</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {info ? (
            <>
              <InfoRow label="Type">
                <span className="flex flex-wrap items-center gap-2">
                  <Badge variant={initial.source === "uploaded" ? "default" : "secondary"}>
                    {initial.source === "uploaded" ? "Uploaded" : "Self-signed"}
                  </Badge>
                  <ExpiryBadge notAfter={info.notAfter} />
                </span>
              </InfoRow>
              <InfoRow label="Subject">{info.subject}</InfoRow>
              {!info.selfSigned && <InfoRow label="Issuer">{info.issuer}</InfoRow>}
              <InfoRow label="Valid">
                {new Date(info.notBefore).toLocaleDateString()} —{" "}
                {new Date(info.notAfter).toLocaleDateString()}
              </InfoRow>
              {info.altNames.length > 0 && (
                <InfoRow label="Hostnames">
                  <span className="flex flex-wrap gap-1.5">
                    {info.altNames.map((n) => (
                      <Badge key={n} variant="outline" className="font-mono font-normal">
                        {n}
                      </Badge>
                    ))}
                  </span>
                </InfoRow>
              )}
              <InfoRow label="SHA-256">
                <span className="font-mono text-xs break-all text-muted-foreground">
                  {info.fingerprint256}
                </span>
              </InfoRow>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              No certificate yet. One is generated automatically the first time the
              production server starts — or create one below.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            generate.mutate();
          }}
        >
          <CardHeader>
            <CardTitle>Create self-signed certificate</CardTitle>
            <CardDescription>
              Generates and activates a fresh certificate for the names below. Browsers show
              a one-time warning for self-signed certificates until you trust it.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="cert-hostnames">Hostnames and IP addresses</Label>
              <Textarea
                id="cert-hostnames"
                value={hostnames}
                onChange={(e) => setHostnames(e.target.value)}
                rows={4}
                className="max-w-sm font-mono text-xs"
                placeholder={"polysiem.lan\n10.0.1.5"}
              />
              <p className="text-xs text-muted-foreground">
                One per line — every name you open PolySIEM under should be listed.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cert-days">Valid for (days)</Label>
              <Input
                id="cert-days"
                type="number"
                min={1}
                max={7300}
                value={days}
                onChange={(e) => setDays(e.target.value)}
                className="max-w-32"
              />
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" disabled={generate.isPending}>
              <RefreshCw className="size-4" />
              {generate.isPending ? "Generating…" : "Generate certificate"}
            </Button>
          </CardFooter>
        </form>
      </Card>

      <Card>
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            upload.mutate();
          }}
        >
          <CardHeader>
            <CardTitle>Upload certificate</CardTitle>
            <CardDescription>
              Use your own certificate — for example one issued by your internal CA or Let’s
              Encrypt. Provide the certificate (with any chain) and its unencrypted private
              key, as PEM.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="cert-pem">Certificate (PEM, chain allowed)</Label>
              <Input
                id="cert-pem-file"
                ref={certFileRef}
                type="file"
                accept=".pem,.crt,.cer,.txt"
                className="max-w-sm"
                onChange={(e) => void readFileInto(setCertPem)(e.target.files?.[0])}
              />
              <Textarea
                id="cert-pem"
                value={certPem}
                onChange={(e) => setCertPem(e.target.value)}
                rows={5}
                className="font-mono text-xs"
                placeholder="-----BEGIN CERTIFICATE-----"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="key-pem">Private key (PEM, unencrypted)</Label>
              <Input
                id="key-pem-file"
                ref={keyFileRef}
                type="file"
                accept=".pem,.key,.txt"
                className="max-w-sm"
                onChange={(e) => void readFileInto(setKeyPem)(e.target.files?.[0])}
              />
              <Textarea
                id="key-pem"
                value={keyPem}
                onChange={(e) => setKeyPem(e.target.value)}
                rows={5}
                className="font-mono text-xs"
                placeholder="-----BEGIN PRIVATE KEY-----"
              />
              <p className="text-xs text-muted-foreground">
                The key is encrypted at rest with your APP_SECRET and never shown again.
              </p>
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" disabled={upload.isPending || !certPem || !keyPem}>
              <FileUp className="size-4" />
              {upload.isPending ? "Uploading…" : "Upload & activate"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
