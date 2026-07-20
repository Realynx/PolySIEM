import { DocEditor, type DocEditorProps } from "@/components/docs/doc-editor";
import { MobilePageHeader } from "@/components/mobile/ui/mobile-page-header";

/**
 * Phone chrome around the shared DocEditor (used by /docs/new and
 * /docs/[slug]/edit). The editor already collapses to a single pane on small
 * screens (split view is lg-only; write/preview toggle in its toolbar), so
 * this wrapper only adds the app bar and restyles the editor's own
 * save/cancel row — targeted via CSS so the component stays untouched — into
 * a sticky full-width action bar that floats above the tab bar. Everything
 * stays in normal document flow, so the on-screen keyboard never hides an
 * input.
 */
export function MobileDocEditorPage({
  title,
  backHref,
  ...editorProps
}: DocEditorProps & { title: string; backHref: string }) {
  return (
    <>
      <MobilePageHeader title={title} backHref={backHref} />
      <div
        className={
          "px-3.5 py-3 " +
          // DocEditor's last child is its cancel/save row.
          "[&>div>div:last-child]:sticky [&>div>div:last-child]:bottom-[calc(3.75rem+env(safe-area-inset-bottom))] [&>div>div:last-child]:z-20 " +
          "[&>div>div:last-child]:rounded-xl [&>div>div:last-child]:border [&>div>div:last-child]:bg-background/95 [&>div>div:last-child]:p-2 [&>div>div:last-child]:shadow-lg [&>div>div:last-child]:backdrop-blur " +
          "[&>div>div:last-child>*]:flex-1"
        }
      >
        <DocEditor {...editorProps} />
      </div>
    </>
  );
}
