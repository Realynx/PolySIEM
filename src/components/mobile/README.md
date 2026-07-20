# Mobile (phone) view

PolySIEM ships a separate phone presentation tree so the installed PWA feels
like a native app instead of a shrunken desktop site. This directory is that
tree. The desktop UI is untouched; phones get their own components.

## How a request picks a view

- `src/lib/device.ts` → `isMobileView()`: UA sniff (phones only — tablets get
  desktop) with a `polysiem_view` cookie override in both directions
  (`setViewMode()` in `src/lib/view-mode.ts`; switchers live in the More sheet
  and the desktop account menu).
- The root layout stamps `mobile-view` on `<html>` (CSS hooks, chat-dock
  offset). The dashboard layout renders `MobileShell` instead of
  sidebar+topbar.

## The one pattern every page follows

```tsx
export default async function SomePage(props) {
  await requirePageUser();
  const data = await anonymizeForDisplay(await loadWhatever());  // fetch ONCE, shared
  if (await isMobileView()) return <MobileSomePage {...data} />; // phone tree
  return ( /* existing desktop JSX, unchanged */ );
}
```

Rules that keep this maintainable (SOLID/DRY):

- **Presentation forks; data does not.** Never add a second query path, service
  call, or derivation for mobile. Fetch/anonymize exactly once, branch last.
- Mobile page components live in `src/components/mobile/pages/<area>/` and are
  **server components** unless they genuinely need interactivity.
- Reuse domain atoms: `StatusBadge`/`SourceBadge`, `TagList`, `formatBytes`,
  existing form dialogs (`EntityFormDialog` etc. — `ui/dialog` already presents
  as a bottom sheet on phone widths), `nav.ts` for anything route-shaped.
- Build screens from the primitives in `mobile/ui/`; don't restyle ad hoc. If a
  primitive is missing, add it to your page area first and promote it here when
  a second area needs it.

## Primitives (`mobile/ui/`)

| Component | Use for |
| --- | --- |
| `MobilePageHeader` | Sticky compact app bar: `backHref`/`back`, `actions`, secondary row via `children` |
| `MobilePage`, `MobileSection` | Body gutter + caption-labelled groups |
| `MobileList`, `MobileListRow`, `MobileKeyRow`, `MobileEmpty` | Lists instead of tables; detail key/values |
| `MobileStatStrip`, `MobileStat` | Horizontal stat chips |
| `MobileSegmented` | Sibling views (tabs); URL-driven |
| `MobileSearchBar` | URL-synced `q` search (same params as `TableToolbar`) |
| `BottomSheet` | Filters, row details, pickers — instead of popover/side sheet |
| `MobileFab` | The page's single primary action; composes with Radix triggers via prop spread |

## Design language (Samsung S26 Ultra ≈ 412×915 css px)

The desktop scale reads "zoomed in" on a phone, so the phone tree is denser on
type and looser on touch targets:

- Titles 15px, body 14px, secondary 12px, captions 11px mono uppercase.
  Never `text-2xl` headers on phone.
- Touch targets ≥44px (`min-h-13` rows) with `active:` press feedback;
  hover states are meaningless — style `active:` instead.
- Lists, not tables. Two-line rows: name+badge on top, metadata below,
  numbers/chevron trailing.
- Full-width primary buttons; icon buttons in the header; FAB for "Add".
- Safe areas: shell handles the tab bar inset; full-bleed screens use
  `pb-safe`/`pt-safe`. Horizontal scrollers get `no-scrollbar`.
- Maps/canvases: full-bleed (own the space outside `MobilePage`), pinch to
  zoom, details in a `BottomSheet` instead of hover popovers.

## Shell (`mobile/shell/`)

`MobileShell` (frame + demo banner) → `MobileTabBar` (Home / Lab / Network /
Security / More) → `MobileMoreSheet` (full nav derived from `NAV_GROUPS`,
search → CommandPalette, theme, desktop-view switch, sign out). New routes
added to `nav.ts` appear in the More sheet automatically; only genuinely new
top-level areas justify touching the tab list.
