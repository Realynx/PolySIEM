import Link from "next/link";
import { ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MobilePageHeader } from "@/components/mobile/ui/mobile-page-header";
import { MobilePage } from "@/components/mobile/ui/mobile-page";
import { MobileEmpty } from "@/components/mobile/ui/mobile-list";

/** Phone empty state for /logs when no Elasticsearch integration exists yet. */
export function MobileLogsEmpty({ isAdmin }: { isAdmin: boolean }) {
  return (
    <>
      <MobilePageHeader title="Logs" />
      <MobilePage>
        <MobileEmpty
          icon={<ScrollText />}
          title="No log source configured"
          description="Connect an Elasticsearch (or compatible) instance as an integration — logs are queried live, never copied into the database."
          action={
            isAdmin ? (
              <Button asChild size="sm">
                <Link href="/settings/integrations">Add an integration</Link>
              </Button>
            ) : undefined
          }
        />
      </MobilePage>
    </>
  );
}
