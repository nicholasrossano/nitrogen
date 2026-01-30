# Nitrogen UI Style Guide  
**Enterprise Visual System (Aesthetic-Only)**

This guide defines the visual language for Nitrogen as an enterprise-grade B2B platform.  
It is prescriptive and concise, prioritizing clarity, restraint, and long-term credibility.

---

## A) Design Principles

- **Calm, institutional, and precise**
- **White-first canvas**
- **Typography-led hierarchy**
- **Restrained geometry**
- **Minimal depth**
- **Color used primarily as meaning**

**Do**
- Keep layouts predictable and grid-aligned  
- Use neutral surfaces by default  
- Apply accent colors deliberately  

**Don’t**
- Use large expressive color fills  
- Introduce playful shapes or motion  
- Mix multiple visual metaphors  

---

## B) Color System (Hex Tokens)

### Core surfaces
| Token | Hex | Usage |
| --- | --- | --- |
| `BackgroundPrimary` | `#FFFFFF` | App background |
| `BackgroundTinted` | `#EFEAE2` | Secondary grouping background |
| `SurfacePrimary` | `#FFFFFF` | Cards / panels |
| `SurfaceSubtle` | `#F7F7F8` | Forms / secondary panels |

### Text
| Token | Hex | Usage |
| --- | --- | --- |
| `TextPrimary` | `#1C1C1E` | Primary text |
| `TextSecondary` | `#5A5A60` | Metadata |
| `TextTertiary` | `#7A7A82` | Helper text |

### Primary accent (use sparingly)
| Token | Hex | Usage |
| --- | --- | --- |
| `AccentAnchor` | `#5F628F` | Rare strong emphasis |
| `AccentPrimary` | `#8285B6` | Borders, focus, selection, links |
| `AccentTint` | `#B2B4D6` | Hover / pressed fills |
| `AccentWash` | `#E6E7F2` | Subtle highlight |

### Semantic indicators
| Token | Hex | Usage |
| --- | --- | --- |
| `IndicatorOrange` | `#B97A5D` | Warning |
| `IndicatorYellow` | `#C6B875` | Pending |
| `IndicatorGreen` | `#9DAA9B` | Success |

### Strokes & dividers
| Token | Hex | Usage |
| --- | --- | --- |
| `Divider` | `#E6E6EA` | Separators |
| `StrokeSubtle` | `#E1E1E6` | Borders |
| `StrokeAccent` | `#8285B6` | Focus / selected border |

**Rules**
- Default UI should read neutral  
- Accent is not a background color  
- Indicator colors encode meaning only  

---

## C) Typography

### Fonts
- **Inter** — primary UI font
- **Urbanist** — limited display/header use

### Type scale
- **Screen Title**: 32, Inter Semibold  
- **Section Header**: 20–24, Urbanist Semibold  
- **Headline**: 18–20, Inter Semibold  
- **Body**: 16, Inter  
- **Body Small**: 14–15, Inter  
- **Caption**: 13–14, Inter  
- **Footnote**: 11–12, Inter Medium  

**Rules**
- Inter by default everywhere  
- Urbanist only for select headers  
- Avoid italics in dense UI  

---

## D) Spacing & Layout

### Spacing scale
`8, 12, 16, 20, 24, 32`

### Conventions
- Horizontal padding: **16–24**  
- Section spacing: **16–24**  
- Card padding: **16–20**  
- Dense stacks: **8–12**

---

## E) Shape & Corner Radius

### Radius scale
- **0** — tables, dense lists  
- **6** — inputs, compact controls  
- **8** — cards / panels  
- **10–12** — modals / sheets  
- **12–16** — chips (sparingly)

**Rules**
- Avoid large soft radii  
- Round containers, not rows  
- Never exceed **16** in core UI  

---

## F) Elevation & Depth

- Flat by default  
- Shadows only if separation is unclear  
- Low opacity, tight radius  
- No glass or blur on core content  

---

## G) Icons & Imagery

### Icons
- **System**: Lucide React (monochromatic, 16-24px stroke)
- **Color**: Inherit from context or use accent colors
- **Usage**: Functional only — enhance meaning, don't decorate
- **No emojis**: Never use emoji in production UI

**Icon color patterns**
- Default state: `text-text-secondary` (neutral)
- Active/selected: `text-accent` (primary accent)
- Status indicators: `text-indicator-*` (semantic meaning)

**Do**
```tsx
<FileText className="w-5 h-5 text-accent" />
<CheckCircle className="w-4 h-4 text-indicator-green" />
```

**Don't**
```tsx
<span>📄</span> // No emojis
<Icon className="w-12 h-12" /> // Too large
<Icon color="#FF5733" /> // Custom colors outside system
```

### Imagery
- Informational imagery only  
- Match image corners to container (8px standard)
- No decorative illustrations  

---

## H) Motion

- Short, fast transitions  
- No expressive easing  
- No playful or elastic motion  

---

## I) Accessibility (Visual)

- WCAG AA contrast minimum  
- Color never sole indicator  
- Focus and selection clearly visible  

---

## J) Visual North Star

The UI should feel at home next to enterprise dashboards, analytics tools, and compliance software.  
If it feels playful or brand-forward, it is likely off-spec.