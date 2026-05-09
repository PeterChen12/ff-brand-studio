# Phase C · Iteration 08 — Empty states & onboarding

**Audit items closed:** #21, #26, #27, #28, #38
**Depends on:** none
**Blocks:** none
**Estimated session length:** small (1 PR, ~hour)

## Why now
First-run experience evaporates after one launch — the 3-step empty
state on the homepage gets replaced by the launch row list and the
user is on her own. The wizard has no progress indicator, just a
3-card layout with eyebrow stamps. Fishing-rod sample copy bleeds
into non-fishing tenants ("Sample SKUs (fishing rods)"). Settings
tabs have no descriptions. The "Compliance bands" reference card
takes prime homepage real-estate that should explain "what's next."

## Files to touch

- `apps/dashboard/src/app/_overview-client.tsx`
  - Replace the "Compliance bands" reference card (lines 244–267)
    with a "What's next" card that shows 1–3 contextual prompts
    based on tenant state:
    - 0 products → "Add your first product"
    - 1+ products, 0 launches → "Generate your first listing"
    - 1+ launches, no exports → "Download your asset bundle"
    - All above done → "Add more products" / link to bulk
  - Replace fishing-specific empty-state copy (line 135) with
    tenant-agnostic phrasing: "Sample products are visible until
    you onboard your own"
- `apps/dashboard/src/components/launch-wizard.tsx`
  - Replace the three `<CardEyebrow>Step 0X · 配置</CardEyebrow>`
    stamps with a single horizontal stepper at the top:
    `[1 Product] → [2 Configure] → [3 Launch]`. Active step bolded;
    completed step gets a checkmark; future step grey
- `apps/dashboard/src/components/launch-wizard.tsx`
  - Tweak panel placeholder (line 1045) — replace fishing-specific
    example with neutral: `'logo is too small — make it 30%
    larger' or 'background looks pixelated, regenerate cleaner'`
- `apps/dashboard/src/app/settings/_client.tsx`
  - Each tab gets a one-line description rendered under the active
    tab strip:
    - Channels: "Where your listings get published"
    - Brand profile: "Defaults applied to every new listing"
    - Advanced: "Developer integrations — API keys & webhooks"

## Acceptance criteria

- [ ] After Mei's first successful launch, the homepage updates the
      "What's next" card to suggest "Download your asset bundle"
      instead of staying on "Compliance bands"
- [ ] Wizard shows a 3-step horizontal stepper at the top. The
      active step has visual emphasis; completed steps show ✓
- [ ] No "fishing" copy anywhere in default UI (tweak placeholder,
      empty states, sample warnings) unless the tenant's category
      list literally contains "fishing"
- [ ] Each Settings tab shows a one-line description below the tab
      strip explaining what's in it

## Implementation notes

- "What's next" card logic lives in the homepage component. Use
  derived state from already-fetched `launches` and `assets`
  arrays — no new endpoint
- Stepper visual: simple horizontal flex with circles + labels;
  use existing M3 colors (`primary` for active, `tertiary` for
  done, `outline-variant` for future)
- The tab description string lives inside the `TABS` array
  (already in `_client.tsx`) as a new `description` field
- Sample placeholder fallback copy can derive from the tenant's
  category if available (e.g. "Sample camp stoves" if tenant
  has products in "outdoor"); else use generic "Sample products"

## Out of scope (do NOT do this iteration)

- A guided tour overlay (tooltips on first visit) — defer to
  iteration 11
- A "completed onboarding tasks" checklist sidebar — too much UI
- Personalized homepage based on user role (admin vs operator) —
  treat all roles equally for v1
- Animated stepper transitions — static is fine
