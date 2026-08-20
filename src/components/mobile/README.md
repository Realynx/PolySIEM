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
| `MobileStateSegmented` (page-area, `pages/network-edge/mobile-edge-tabs.tsx`) | Sibling views **inside a repeated card**; component state, not the URL |
| `MobileSummaryLine` (page-area, `pages/network-edge/mobile-edge-tabs.tsx`) | Two or three headline counts on one line, where a `MobileStatStrip` would spend ~64px of the first screen on them |
| `MobileCollapseCard`/`Head`/`Body` (page-area, `pages/network-edge/mobile-edge-collapse.tsx`) | Collapse a **repeated** card whose identity row doubles as the control |
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
- One sheet at a time. A sub-sheet (edit form, scanner, picker) opened from a
  row's detail sheet **replaces** it and reopens it on close — stacking two
  `BottomSheet`s fights over the scroll lock and buries the back gesture.
- When the same entity is listed from two places (every connector on the
  Connectors tab, and the ones linked to one edge box on that edge's card), the
  two lists own only their rows. Every sheet they open — detail, edit, setup,
  delete — lives in one shared "sheet host" component that the list mounts with
  the selected id, so the two surfaces can never drift apart in behaviour.
- A card with several long sections (the edge server card: routes, connectors,
  tunnel, interfaces) gets a segmented control instead of one long scroll: the
  identity, state and primary actions stay pinned, and **only the selected
  section renders**. Several such cards can share a screen, so the selection
  lives in component state and each segment carries a compact badge (count,
  "2/3 ready", On/Off) so the tab strip doubles as the summary. Mirror the
  desktop card's tab order so both views describe the same thing.
- **A screen of repeated cards collapses; a list that can grow scrolls in
  place.** Once several cards of the same shape share a screen — edge boxes,
  Cloudflare tunnels — each one collapses, and the *identity row is the control*
  (a 52px target with the count and a chevron trailing it) because a phone header
  has no room for a second button. Collapsed must still answer name, state and
  count. Whether they start open is one decision for the whole screen, taken by
  `edgeCardsStartExpanded` in `network/cloudflare-presentation.ts` so desktop and
  phone use the same threshold. Inside a card, a section that has no upper bound
  (one tunnel can publish 200 hostnames) gets `max-h-* overflow-y-auto
  overscroll-contain` on a **wrapper** — `MobileList` clips its own corners, and
  a list that both clips and scrolls can silently swallow rows — plus the shared
  count sentence, so nothing is ever hidden without saying so.
- **Show state and consequence, not bookkeeping.** A card's always-visible part
  answers "what is this, can we reach it, is what I configured actually live,
  and what do I press" — for the edge card that is one plain-language sync line
  (`3 routes staged · not pushed to the edge yet`, `In sync · pushed 3m ago`)
  plus one primary button. Revisions, hashes, fingerprints and kernel flags are
  real and stay reachable, but they belong in a details `BottomSheet` behind
  that line, not on the first screen.
  `pages/network-edge/mobile-edge-sync.tsx` is the worked example.
- **Words about shared state live in the shared module, not here.** When a
  desktop surface already describes the same thing, mobile imports its wording
  and derives only the phone treatment from it. The edge pages take their sync
  sentence, fact list, route badges, path text and sensitive-port table from
  `network/edge-sync-presentation.ts`, every Cloudflare fact — tunnel cards,
  route rows, counts, config source, collapse and scroll thresholds — from
  `network/cloudflare-presentation.ts`, and the far-side setup steps for a manual
  connector from `connectorSetupInstructions` in `network/edge-networks-types.ts`
  (all deliberately React-free), and keep just the tone→colour map, the amber
  gate and the tap-to-copy split local. Two
  copies of a rule like "which ports are risky when unrestricted" drift, and a
  port that warns on desktop while staying silent on a phone is a safety bug,
  not a styling one.
- **Do not repeat the card's state on every row.** A per-row badge that reads
  the same on all N rows carries no information; badge a row only where it
  *differs* from the card (disabled, already live, not applied yet). Same for
  prose: a footnote explaining a status column means the column is wrong.
- **Amber and ⚠ mean something is wrong**, and the text says what. Normal
  configuration — routing through a connector, a rule with no source CIDR, a
  connector not linked yet, forwarding that the next Apply turns on — is
  neutral. A banner that renders in every state is not a banner; gate it on the
  state it describes.
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
