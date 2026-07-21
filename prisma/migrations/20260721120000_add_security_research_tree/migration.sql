-- Organize research pages into the same kind of parent/child hierarchy used
-- by documentation pages. Deleting a parent promotes its children to roots.
ALTER TABLE "SecurityResearchPage" ADD COLUMN "parentId" TEXT;

CREATE INDEX "SecurityResearchPage_parentId_idx" ON "SecurityResearchPage"("parentId");

ALTER TABLE "SecurityResearchPage"
ADD CONSTRAINT "SecurityResearchPage_parentId_fkey"
FOREIGN KEY ("parentId") REFERENCES "SecurityResearchPage"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
