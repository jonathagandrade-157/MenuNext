---
name: Modern Gastronomy B2B SaaS
colors:
  surface: '#faf8ff'
  surface-dim: '#d4d9ed'
  surface-bright: '#faf8ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f1f3ff'
  surface-container: '#e9edff'
  surface-container-high: '#e2e8fc'
  surface-container-highest: '#dde2f6'
  on-surface: '#151b29'
  on-surface-variant: '#5b4139'
  inverse-surface: '#2a303f'
  inverse-on-surface: '#edf0ff'
  outline: '#8f7067'
  outline-variant: '#e4beb4'
  surface-tint: '#af3100'
  primary: '#ab2f00'
  on-primary: '#ffffff'
  primary-container: '#d53e02'
  on-primary-container: '#fffbff'
  inverse-primary: '#ffb59f'
  secondary: '#b41e04'
  on-secondary: '#ffffff'
  secondary-container: '#d8391e'
  on-secondary-container: '#fffbff'
  tertiary: '#006947'
  on-tertiary: '#ffffff'
  tertiary-container: '#00855b'
  on-tertiary-container: '#f5fff6'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffdbd1'
  primary-fixed-dim: '#ffb59f'
  on-primary-fixed: '#3a0a00'
  on-primary-fixed-variant: '#862300'
  secondary-fixed: '#ffdad3'
  secondary-fixed-dim: '#ffb4a5'
  on-secondary-fixed: '#3f0400'
  on-secondary-fixed-variant: '#8f1200'
  tertiary-fixed: '#6ffbbe'
  tertiary-fixed-dim: '#4edea3'
  on-tertiary-fixed: '#002113'
  on-tertiary-fixed-variant: '#005236'
  background: '#faf8ff'
  on-background: '#151b29'
  surface-variant: '#dde2f6'
typography:
  display:
    fontFamily: Plus Jakarta Sans
    fontSize: 48px
    fontWeight: '800'
    lineHeight: 56px
    letterSpacing: -0.03em
  headline-xl:
    fontFamily: Plus Jakarta Sans
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 44px
    letterSpacing: -0.025em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 36px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 30px
    letterSpacing: -0.015em
  headline-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 26px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: -0.005em
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: 0em
  body-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0.005em
  label-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: 0.01em
  label-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.02em
  label-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 11px
    fontWeight: '700'
    lineHeight: 14px
    letterSpacing: 0.04em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  space-2xs: 0.25rem
  space-xs: 0.5rem
  space-sm: 0.75rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2rem
  space-2xl: 3rem
  space-3xl: 4rem
  gutter: 1.5rem
  container-max: 1440px
---

## Brand & Style

The design system establishes a high-performance, polished, and conversion-driven environment for food service operators—from high-volume dark kitchens and burger joints to artisanal pizzerias and multi-location franchises. 

The aesthetic is crisp, utilitarian, and technologically advanced while maintaining the energetic warmth intrinsic to gastronomy. It avoids sterile corporate stiffness through vivid, deliberate accents of luminous orange, balanced strictly against clinical graphite neutrals, pure white surfaces, and subtle, tactile slate borders.

### Design Movement
**Modern SaaS with Tactile Warmth:**
- **Surfaces:** Clean, layered architectural planes with deliberate contrast between white action containers and cool slate backdrops.
- **Rhythm:** High-density operational data views (KDS, order dispatching, menu matrices) balanced with expansive executive summaries and analytical dashboards.
- **Micro-Interactions:** Snappy, decisive feedback loops (150–200ms transitions) that signal operational speed and reliability during peak restaurant kitchen hours.

## Colors

The color palette is built for rapid visual parsing under ambient kitchen lighting and fast-paced counter operations. 

### Role Assignments
- **Primary (`#F95721`):** Reserved strictly for critical high-intent touchpoints: checkout submission, primary CTA buttons, status toggles (e.g., active store state), and high-priority order badges.
- **Secondary (`#FF5436`):** Used for gradient accents, hover elevations of primary assets, and attention-grabbing promotional states.
- **Tertiary / Positive Utility (`#10B981`, deep `#059669`):** Crucial operational indicators including "Loja Aberta" (Open Store), incoming live orders, successful telemetry, and positive margin deltas.
- **Neutral Core (`#121826`):** Deep graphite foundation providing ultra-crisp typography contrast (`98%` contrast rating against `#FFFFFF`).
- **Neutral Scale & Surfaces:**
  - `Surface Base`: `#F8FAFC` (Slate 50) for canvas backgrounds.
  - `Surface Card`: `#FFFFFF` (Pure White) for distinct visual elevation.
  - `Surface Subdued`: `#F1F5F9` (Slate 100) for inner metric pods, table headers, and form track backgrounds.
  - `Border / Divider`: `#E2E8F0` (Slate 200) for structural low-contrast bounding boxes.
  - `Text Muted`: `#64748B` (Slate 500) for secondary metrics, timestamps, and column labels.

## Typography

Plus Jakarta Sans delivers structural geometry with humanized terminals, providing clean numerical legibility across high-density order screens and billing reports.

### Hierarchy Guidelines
- **Numbers & Metrics:** Use `font-weight: 700` with tabular figures (`font-variant-numeric: tabular-nums`) for currency values, SKU counts, and timer clocks.
- **Labels & Microcopy:** `label-sm` is rendered in uppercase with `0.04em` tracking for table super-headers, kitchen ticket categories, and status chips.
- **Headings:** Heavy weight (`700` / `800`) combined with negative letter spacing ensures immediate visual anchor points when scanning dashboards.

## Layout & Spacing

The layout is desktop-first, calibrated for restaurant POS terminals, manager tablets, and back-office widescreen monitors.

### Grid Architecture
- **Desktop (1024px+):** 12-column grid with `1.5rem` (24px) gutters and max-width capped at `1440px`. Fluid dashboard panels employ a persistent 260px collapsible sidebar navigation.
- **Tablet (768px - 1023px):** 8-column layout with `1rem` gutters; sidebar collapses to an icon dock (72px).
- **Mobile (< 768px):** 4-column layout with `1rem` edge margins. Primary restaurant operations consolidate into bottom-anchored sheets and persistent status headers.

### Density Tiers
- **Comfort (Analytics & Settings):** Card paddings set to `2rem` (`space-xl`), gap rhythm at `1.5rem` (`space-lg`).
- **Compact (Live Orders & Kitchen Board):** Card paddings compressed to `1rem` (`space-md`), item row spacing at `0.5rem` (`space-xs`) for maximum visible items above the fold.

## Elevation & Depth

Visual depth is achieved through layered structural tones reinforced by soft, non-directional ambient occlusion shadows tinted with the neutral graphite base.

### Depth Hierarchy
- **Level 0 (Canvas):** `#F8FAFC` base tone. No shadow.
- **Level 1 (Structural Cards & Tables):** `#FFFFFF` surface with `1px` continuous border in `#E2E8F0` and `shadow-sm` (`0 1px 3px 0 rgba(18, 24, 38, 0.05)`).
- **Level 2 (Interactive Floating & Metrics):** Active states and summary KPI cards utilize `shadow-md` (`0 4px 12px -2px rgba(18, 24, 38, 0.08), 0 2px 4px -1px rgba(18, 24, 38, 0.03)`).
- **Level 3 (Modals, Slide-overs & Flyouts):** `shadow-xl` (`0 20px 25px -5px rgba(18, 24, 38, 0.1), 0 10px 10px -5px rgba(18, 24, 38, 0.04)`) with backdrop blur of `4px` on underlying canvas.
- **Brand Elevation (Primary Action Focus):** Key CTA buttons hover with a warm primary glow: `0 8px 20px -4px rgba(249, 87, 33, 0.35)`.

## Shapes

The geometric vocabulary balances modern ergonomics with clear boundaries:

- **Outer Containers & Large Cards:** `1rem` (`rounded-xl` / `16px`) to establish friendly, modern structural zones.
- **Inner Modals & Hero Feature Blocks:** `1.5rem` (`rounded-2xl` / `24px`) for elevated spatial separation.
- **Form Controls & Inputs:** `0.5rem` (`rounded-lg` / `8px`) maintaining crisp precision for keyboard input flows.
- **Badges, Status Chips & Pills:** Full border radius (`9999px` / `rounded-full`) for instant distinction from actionable buttons and cards.

## Components

### Buttons
- **Primary:** Background `#F95721` transitioning to `#FF5436` on hover; text pure white (`#FFFFFF`), `rounded-xl`, vertical padding `0.75rem`, horizontal padding `1.25rem`, font weight `600`. Active state scales subtly (`0.98`).
- **Secondary:** Surface `#FFFFFF`, border `1.5px solid #E2E8F0`, text `#121826`. Hover changes border to `#CBD5E1` and background to `#F8FAFC`.
- **Ghost:** Transparent fill, text `#64748B`, hover text `#121826`, hover surface `#F1F5F9`.

### Badges & Status Chips (Pills)
- Always rendered with `rounded-full`, `px-3`, `py-1`, text size `label-sm`.
- **Loja Aberta / Pedido Confirmado (Success):** Background `#ECFDF5`, text `#059669`, with an active pulsing indicator dot (`#10B981`).
- **Atenção / Preparo (Warning):** Background `#FFFBEB`, text `#B45309`.
- **Cancelado / Urgente (Destructive):** Background `#FEF2F2`, text `#DC2626`.

### Inputs & Selectors
- Height `44px` for touch and click ergonomics.
- Border `1px solid #E2E8F0`, background `#FFFFFF`, text `#121826`, placeholder `#94A3B8`.
- Focus state: border color `#F95721` with a `3px` focus ring tinted `#F95721` at `15%` opacity.

### Cards & Data Panels
- Background `#FFFFFF`, rounded `1rem` (`rounded-xl`), border `1px solid #E2E8F0`.
- Internal sections are separated using `1px` `#F1F5F9` dividers rather than heavy black borders.

### Restaurant-Specific Modules
- **Live Order Card:** Top-bordered status accent line (`4px` solid `#F95721` or `#10B981`), prominent order timer counter in tabular format, customer channel badge (iFood, Menu Direct, Balcão), and high-contrast quick action trigger ("Despachar Pedido").
- **Store Status Toggle:** Prominent switch module in navigation header featuring dual state pill: `#10B981` ("Loja Aberta") and `#94A3B8` ("Loja Fechada").