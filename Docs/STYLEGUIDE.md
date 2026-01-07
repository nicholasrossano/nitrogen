# Foreword UI Style Guide

This guide codifies the current visual system based on existing assets and SwiftUI views. It is descriptive (not aspirational) so new UI stays consistent with what’s already shipping.

## A) Design Principles
- **Warm, editorial, and slightly artisanal.** The palette leans warm (beige/cream/burgundy) with muted neutrals and soft contrast.
- **Soft surfaces and rounded geometry.** Rounded rectangles (often 18–25 radius) dominate, with pills/capsules for controls.
- **Glass/blur accents for chrome.** Navigation and overlay elements frequently use `ultraThinMaterial`/`thinMaterial` and glass effects.
- **Legible, friendly typography.** Avenir is the default body font; Didot is used sparingly for display/hero moments.
- **Lightweight, quick motion.** Animations are mostly ease-in-out between 0.12s–0.5s; springs are subtle.
- **Subtle elevation, not dramatic depth.** Shadows are gentle (opacity ~0.1–0.35) and used to lift cards and pills.

**Do**
- Use warm neutrals for surfaces and the burgundy/red family for emphasis.
- Keep corners rounded and consistent; prefer `continuous` rounded rectangles.
- Apply blur/material only to chrome (toolbars, nav capsules, overlays), not core content.

**Don’t**
- Introduce neon or high-saturation colors outside the existing palette.
- Add sharp corners or heavy drop shadows that break the soft look.
- Replace Avenir body text with a new font family.

## B) Color System
All named colors below are from `resources/Assets.xcassets/Colors/*`.

| Asset Name | Hex (Light) | Hex (Dark) | Role / Usage Notes |
| --- | --- | --- | --- |
| `Background` | `#FEFCF5` | `#FEFCF5` | BackgroundPrimary (app background) |
| `Cream` | `#FFFEF9` | `#FFFEF9` | BackgroundSecondary / soft surface |
| `Beige` | `#DAD7C5` | `#E4DEC7` | Surface / cards / art accents |
| `Blush` | `#ECE4DB` | `#ECE4DB` | Surface-alt / light fills |
| `Brown` | `#301900` | `#301900` | TextPrimary / icon text |
| `SecondaryColor` | `#301900` | `#E4DEC7` | TextSecondary / contrast inversion |
| `PrimaryColor` | `#8D1717` | `#DA4A4A` | Brand / primary accent |
| `PrimaryColor-Old` | `#622C8A` | `#622C8A` | Legacy brand (avoid new use) |
| `AccentPrimary` | `#8D1717` | `#DA4A4A` | Accent (matches PrimaryColor) |
| `AccentSecondary` | `#301900` | `#E4DEC7` | Accent secondary / dark neutral |
| `AccentTertiary` | `#301900` | `#ECE4DB` | Accent tertiary / light neutral |
| `Burgundy` | `#8D1717` | `#DA4A4A` | Destructive / emphasis |
| `Merlot` | `#711248` | `#711248` | Deep accent / specialty |
| `Rust` | `#BD6217` | `#BD6217` | Warning / warm accent |
| `Forest` | `#127112` | `#127112` | Success / positive feedback |
| `Teal` | `#0E7171` | `#0E7171` | Informational / secondary accent |

**Hardcoded colors in use (migration targets):**
- `Color.black.opacity(...)` and `Color.white.opacity(...)` are used for scrims, strokes, and text-on-dark. Map to semantic tokens like `OverlayScrim`, `StrokeSubtle`, and `TextInverse` in `DesignTokens`.
- System colors such as `Color(.systemBackground)`, `.secondarySystemBackground`, `Color.primary`, and `Color(.separator)` are used for form fields and card backgrounds; document as `SurfaceSystem`/`Divider` tokens for future alignment.

## C) Typography
**Fonts in use**
- **Avenir** (`.custom("Avenir", size: 14–20)`): primary body font.
- **Avenir-Medium** (`.custom("Avenir-Medium", size: 16–18)`): emphasis for labels and buttons.
- **Didot-Bold** (`.custom("Didot-Bold", size: 20)`): select headers.
- **Didot-Italic** (`.custom("Didot-Italic", size: 44)`): hero/brand moment.
- **System** (`.system(size: 28–32, weight: .semibold)` and larger 50/60): title or status emphasis.

**Type scale (mapped to existing usage)**
- **Title / Display XL (60)**: status or celebratory iconography.
- **Display L (50)**: premium hero/icon; limited use.
- **Display M (44, Didot-Italic)**: auth/onboarding hero.
- **Title (32, semibold system)**: screen titles.
- **Headline (20, semibold system or Didot-Bold 20)**: cards, section titles.
- **Body (16, Avenir)**: main text, buttons.
- **Body Small (15, Avenir)**: secondary text.
- **Caption (14, Avenir)**: metadata, pills.
- **Footnote (10–12, system semibold)**: tiny helper text.

**Usage guidance**
- Use **Avenir 16** for most body copy and button labels.
- Use **Avenir 14–15** for metadata, pills, and form hints.
- Reserve **Didot** for rare hero moments (auth splash, standout headers).

## D) Spacing & Layout
**Observed spacing scale** (from usage): `4, 8, 10, 12, 16, 20, 22, 24, 32, 60`.

**Conventions**
- **Default screen padding**: 16–24 horizontal; 8–12 vertical for stacked sections.
- **Card padding**: typically 12–20 depending on density.
- **Stack spacing**: commonly 4–12 for tight stacks; 16–24 for section separation.
- **Safe area**: explicit top/bottom padding is often applied in full-screen views (especially with overlays and toolbars). Favor `topSafe + 12/16` and `bottomInset + 12` when stacking floating controls.

**Layouts**
- **Cards**: Rounded rectangles with 20 radius, subtle border, and soft shadow.
- **Lists**: Compact vertical stacks with 8–12 spacing and light separators.
- **Grids**: Rounded tiles (20–24 radius), inset padding and subtle shadow.
- **Modals/Sheets**: Use thin/ultra-thin materials with rounded corners and soft shadows; prefer compact spacing.

## E) Shape, Corner Radius, and Borders
**Radius scale** (observed): `5, 6, 8, 10, 14, 16, 18, 20, 22, 24, 25, 30, 50`.

**Defaults**
- **Cards / tiles**: 20.
- **Pills / chips**: 18.
- **Inputs**: 10 (border radius) or 16 for larger surfaces.
- **Navigation capsule**: 50 (fully rounded).

**Borders**
- Light strokes are common (`0.5–1.5` width) with white opacity or system separator.
- Prefer subtle strokes over heavy borders; keep opacity <= 0.7.

## F) Elevation, Shadows, and Materials (Glass)
**Shadow levels** (from current usage)
- **Subtle**: black @ 10–15% opacity, radius 3–4, y 1–3.
- **Lifted**: black @ 18–20% opacity, radius 6, y 4.
- **Heavy**: black @ 30–35% opacity, radius 8–10, y 3–4.
- **Glow** (special case): beige glow with large radius (14–22) for onboarding highlights.

**Materials / glass**
- **Used** in navigation capsules, close buttons, banners, and overlay chrome.
- Materials observed: `.ultraThinMaterial`, `.thinMaterial`, `.thickMaterial`, `.regularMaterial`.
- **Rule**: use glass/materials for chrome and overlays, not primary content blocks.

## G) Icons & Imagery
- **Icons**: SF Symbols (`Image(systemName: ...)`) are the standard.
- **Sizing**: icon glyphs are often 40–50% of container size (e.g., close button), with semibold weight.
- **Alignment**: icons centered inside pills/circles; align with text baselines for inline icons.
- **Images**: cards use rounded rectangles with 20+ radius; thumbnails may add strokes/blur backgrounds.

## H) Motion & Haptics
- **Animation**: `easeInOut` 0.12–0.5s; `easeIn` for dismiss; spring response ~0.18 with damping ~0.7 for press feedback.
- **Appropriate use**: transitions for overlays, pills, and suggestion rows; avoid long/elastic motion.
- **Haptics**: `UIImpactFeedbackGenerator` light is most common; medium/heavy used for navigation/emphasis; soft for swipe center feedback.

## I) Components Catalog
(Representative components based on existing views)

- **Card / Tile** (e.g., `CardTile`, `GlanceCard`, `CardPreviewThumbnailView`)
  - Purpose: primary content container.
  - Visuals: 20 radius, subtle stroke, soft shadow, image/gradient backdrops.
  - States: normal, loading/blurred, selected.
  - Reuse: feeds, grids, shelves.

- **Primary Buttons / Action Capsules** (`ActionCapsule`, `OpenInPill`, `VoteButton`)
  - Purpose: primary CTA and in-card actions.
  - Visuals: pill/capsule shapes (18–25 radius), Avenir 14–16, subtle shadow.
  - States: normal, pressed, selected.

- **Chips / Pills** (`DomainPill`, `NavigationCapsule`)
  - Purpose: category selection, navigation toggles.
  - Visuals: 18–50 radius, thin strokes, glass background for nav.
  - States: selected/unselected.

- **Input Field** (`InputField`)
  - Purpose: text input for feedback and forms.
  - Visuals: 10 radius, Avenir 14, separator stroke, system background fill.
  - States: focused/unfocused, multiline.

- **Banner / Toast** (`BannerView`, `ReportToastView`)
  - Purpose: transient feedback.
  - Visuals: thin material, 20 radius, subtle shadow, headline+subheadline.
  - States: default.

- **Toolbar / Chrome** (`NavigationCapsule`, `CloseButton`, `CuratorInputBar`)
  - Purpose: navigation/overlay controls.
  - Visuals: ultra-thin material, capsule/circle shapes, thin white stroke.

- **Empty / Loading** (`EmptyStackIcon`, `GlobalLoadingIndicator`, `Shimmer`)
  - Purpose: placeholder states.
  - Visuals: glass/ultra-thin materials and muted colors.

## J) Accessibility Baseline
- **Tap targets**: aim for ≥44×44 for primary actions; pills are currently ~32–40 high, so avoid shrinking further.
- **Dynamic Type**: allow scaling up to `.large` where used (cards already constrain with `dynamicTypeSize`).
- **Contrast**: use `Color.primary`/`secondary` on system backgrounds; for overlay text, ensure white text on dark scrims.

---

### Inconsistencies & Recommendations (document-only)
- **Radii vary** (18/20/24/25/30/50). Recommend standardizing to 20 for cards and 18 for pills; keep 50 for nav capsules.
- **Spacing varies** (10/12/16/20/22/24). Prefer using the main scale (8/12/16/20/24) and reserve 10/22 for legacy layouts.
- **Shadow parameters vary**. Consolidate into the three levels above; keep special glow only in onboarding.
