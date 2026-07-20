-- Add Tailscale as both a configured integration and an inventory evidence source.
ALTER TYPE "IntegrationType" ADD VALUE 'TAILSCALE';
ALTER TYPE "Source" ADD VALUE 'TAILSCALE';
