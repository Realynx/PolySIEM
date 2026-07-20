-- Add new enum values (must be committed before use in later migrations)
ALTER TYPE "Source" ADD VALUE IF NOT EXISTS 'UNIFI';
ALTER TYPE "IntegrationType" ADD VALUE IF NOT EXISTS 'UNIFI';
