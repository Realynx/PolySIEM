CREATE TABLE "RateLimitBucket" (
  "key" TEXT NOT NULL,
  "count" INTEGER NOT NULL,
  "windowStartedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "RateLimitBucket_expiresAt_idx" ON "RateLimitBucket"("expiresAt");

CREATE TABLE "WorkflowWebhook" (
  "token" TEXT NOT NULL,
  "workflowId" TEXT NOT NULL,
  "nodeId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkflowWebhook_pkey" PRIMARY KEY ("token")
);

CREATE UNIQUE INDEX "WorkflowWebhook_workflowId_nodeId_key"
  ON "WorkflowWebhook"("workflowId", "nodeId");
CREATE INDEX "WorkflowWebhook_workflowId_idx"
  ON "WorkflowWebhook"("workflowId");
ALTER TABLE "WorkflowWebhook" ADD CONSTRAINT "WorkflowWebhook_workflowId_fkey"
  FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill existing webhook nodes. Tokens are already stored in workflow.graph;
-- the materialized table only makes lookup indexed and bounded.
INSERT INTO "WorkflowWebhook" ("token", "workflowId", "nodeId")
SELECT
  node->'config'->>'token',
  workflow."id",
  node->>'id'
FROM "Workflow" AS workflow
CROSS JOIN LATERAL jsonb_array_elements(
  CASE
    WHEN jsonb_typeof(workflow."graph"->'nodes') = 'array' THEN workflow."graph"->'nodes'
    ELSE '[]'::jsonb
  END
) AS node
WHERE node->>'kind' = 'trigger.webhook'
  AND COALESCE(node->'config'->>'token', '') <> '';

-- Integration identity resolution compares the first DNS label case-insensitively.
-- Functional partial indexes avoid loading/scanning complete active inventories.
CREATE INDEX "Device_active_normalized_name_idx"
  ON "Device" ((lower(split_part(rtrim("name", '.'), '.', 1))))
  WHERE "status"::text <> 'REMOVED';
CREATE INDEX "VirtualMachine_active_normalized_name_idx"
  ON "VirtualMachine" ((lower(split_part(rtrim("name", '.'), '.', 1))))
  WHERE "status"::text <> 'REMOVED';
CREATE INDEX "Container_active_normalized_name_idx"
  ON "Container" ((lower(split_part(rtrim("name", '.'), '.', 1))))
  WHERE "status"::text <> 'REMOVED';
