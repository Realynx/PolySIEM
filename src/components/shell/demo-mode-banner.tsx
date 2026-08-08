import { LockKeyhole } from "lucide-react";

/** Shared demo notice so desktop and mobile use identical copy and theme tokens. */
export function DemoModeBanner() {
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 border-b border-primary/20 bg-primary/10 px-4 py-2 text-center text-xs font-medium text-primary"
    >
      <LockKeyhole className="size-3.5 shrink-0" aria-hidden />
      <span>Public demo — exploration is enabled; persistent changes are locked.</span>
    </div>
  );
}
