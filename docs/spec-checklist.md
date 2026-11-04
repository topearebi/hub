# Specification Quality Checklist & Feature Spec Template

**Document Version:** 1.0.0
**Purpose:** Catch product and design defects _before_ code is written. Use it when writing or changing any requirement in `PRD.md`, any component or token in `DESIGN.md`, or any feature plan in `plans/`.
**Why it exists:** The production-readiness audit ([`plans/production-readiness.md`](../plans/production-readiness.md)) found that most serious defects were written into the specs: hover-only controls, text tokens below 4.5:1 contrast, a URL regex that rejects `localhost`, copy that referenced a key that does not exist. Other defects were missing requirements (touch, accessibility, undo, install, durability). A spec that is wrong or silent produces correct code for the wrong product.

---

## 1. When to use it

| Moment                                                | Action                                                          |
| ----------------------------------------------------- | --------------------------------------------------------------- |
| Starting a feature or phase                           | Fill in the feature spec template (§3) and tick §2              |
| Changing `DESIGN.md` tokens, components or copy       | Tick §2.3 and run the contrast script (once it exists, Phase 2) |
| Changing `PRD.md` requirements or acceptance criteria | Tick §2.1, §2.2 and §2.4                                        |
| Before approving a spec for implementation            | A second reviewer (human or agent) ticks §2 independently       |
| Opening a pull request                                | Reference the spec section; the PR template repeats the gates   |

A spec is not "approved for implementation" until every applicable box below is ticked or has a written, owner-approved waiver.

---

## 2. Pre-implementation checklist

### 2.1 Context and user

- [ ] The primary scenario is stated in one sentence (who, where, on what device, with what connectivity). For Hub: _one-handed on a phone, often offline, needing key information within seconds._
- [ ] The device priority follows from that scenario (design for the phone first, then scale up).
- [ ] The feature has a stated user goal and a success measure ("a first-time user adds a link in under 60 seconds"), not just a behaviour description.
- [ ] Failure is designed for: empty, loading, offline, error, partial-data and first-run states are each described.

### 2.2 Non-functional requirements are stated, measurable and testable

Every item needs a threshold, not an adjective. "Accessible" and "fast" are not requirements.

- [ ] **Touch:** hit areas ≥ 44 × 44 px on coarse pointers (24 px absolute floor); nothing hover-only, right-click-only or drag-only.
- [ ] **Accessibility:** WCAG 2.2 AA; keyboard path, touch path and screen-reader path each described (`docs/accessibility.md` §7 parity table).
- [ ] **Contrast:** text ≥ 4.5:1, control boundaries and focus ≥ 3:1 in light, dark, `prefers-contrast: more` and forced-colors.
- [ ] **Responsive:** behaviour defined for each tier in `DESIGN.md` §3, including landscape, safe areas and the on-screen keyboard.
- [ ] **Offline and durability:** works without a network; data survives storage pressure and updates; what happens when sync fails.
- [ ] **Performance:** stays within the budget in `PRD.md` §3.1 (bundle, LCP, INP, CLS, omnibar filter time).
- [ ] **Privacy and security:** adds no request to any host other than same-origin or `api.github.com`; secrets are never logged, exported or synced; no `innerHTML` with user content.
- [ ] **Recoverability:** every destructive action is undoable or confirmed (`DESIGN.md` §9); unsaved input is never discarded silently.
- [ ] **Internationalisation:** strings are catalogued, CSS uses logical properties, dates use the local calendar and `Intl`.

### 2.3 Design values are verified, not asserted

- [ ] Every colour pair in the spec has a computed contrast ratio written next to it (never hand-picked hex values without a check).
- [ ] Every size in the spec is in `rem`/tokens; no new raw literals for colour, spacing, font size or `z-index`.
- [ ] Every interaction states its trigger for **all** input methods (touch, mouse, keyboard, screen reader, gamepad where relevant).
- [ ] Every control lists its states: default, hover (fine pointers only), pressed, focus-visible, disabled, invalid, loading.
- [ ] Copy is written out in full (empty states, errors, confirmations) and references only things that exist (no keys, buttons or screens that are not in the spec).
- [ ] Examples and sample values are real: URLs include `localhost:3000`, an IPv4 address and an internationalised domain; names include emoji and non-Latin scripts; dates cross midnight in a non-UTC timezone.

### 2.4 Spec consistency and traceability

- [ ] The requirement lives in exactly one document; other documents link to it instead of copying it (tokens: `DESIGN.md` §2; data: `SCHEMAS.md`).
- [ ] New data fields are listed in `SCHEMAS.md` and explicitly approved by the owner (`AGENTS.md` prime directive 2).
- [ ] Each requirement has an acceptance test (unit, component, automated accessibility, Lighthouse, or a named manual device check) and an owner phase.
- [ ] The requirement references its gap ID (`G-xx`) if it closes one.
- [ ] Nothing in the spec contradicts an existing negative constraint in `AGENTS.md` §2.

### 2.5 Independent review (pre-mortem)

- [ ] A second reviewer read the spec cold and answered: _"If a developer built exactly this and nothing else, what would a user on a phone, with a screen reader, offline, on a bad day, be unable to do?"_
- [ ] The answers are either fixed in the spec or recorded as accepted risks with an owner.
- [ ] The review checked the spec against current platform guidance (WCAG 2.2, iOS and Android conventions, PWA install criteria), not only against the codebase.

---

## 3. Feature spec template

Copy into `plans/<feature>.md`. Keep it to one or two pages. If a section does not apply, write "n/a" and why.

```markdown
# <Feature name>

**Status:** Draft | In review | Approved | Complete
**Gap IDs:** G-xx, G-yy (or "none")
**Parent specs:** PRD §x.y, DESIGN §x.y, SCHEMAS §x.y

## 1. User and scenario

Who, where, device, connectivity. The single sentence this feature must make true.

## 2. Goal and success measure

What the user achieves, and how we will know (a measurable outcome).

## 3. Behaviour

Numbered requirements. Each is testable. Describe the primary flow, then:

- Empty / first-run state:
- Loading state:
- Error and offline states:
- Undo / recovery:

## 4. Interaction by input method

| Action | Touch | Mouse | Keyboard | Screen reader |
| ------ | ----- | ----- | -------- | ------------- |

## 5. Layout and design

Tokens used (no new literals), tiers affected (`DESIGN.md` §3), component states, copy (full text).

## 6. Data and privacy

Fields read or written (reference SCHEMAS.md), network calls (must be none beyond same-origin / api.github.com), what is stored where, what must never be synced or logged.

## 7. Non-functional thresholds

Touch size, contrast, performance, offline behaviour, accessibility criteria that apply, with the numbers.

## 8. Acceptance tests

- Automated: unit/component tests, axe, Lighthouse, target-size, contrast.
- Manual: devices and assistive technology to check (see `plans/production-readiness.md` §5.3).

## 9. Out of scope / risks / open questions

Anything deliberately excluded; decisions still needed from the owner.
```

---

## 4. Anti-patterns this checklist is designed to catch

| Anti-pattern seen in the original specs                               | Which check catches it |
| --------------------------------------------------------------------- | ---------------------- |
| Hex values chosen by eye, never checked                               | §2.3 first item        |
| "Revealed on hover" for essential actions                             | §2.2 Touch, §2.3 third |
| One input method specified (right-click menu; drag only)              | §2.3 third, §3 §4      |
| Mandating auto-focus on boot without considering phones               | §2.1 device priority   |
| A URL regex tested only on `example.com`                              | §2.3 last item         |
| Copy that mentions a key that does not exist                          | §2.3 fifth item        |
| Exit criteria such as "Lighthouse passes" with no recorded result     | §2.4 acceptance test   |
| Same token block copied into two documents and left to drift          | §2.4 first item        |
| Polish and responsiveness deferred to the last phase                  | §2.1, §2.5             |
| No mention of undo, offline failure, install, durability or first run | §2.1, §2.2             |

---

## 5. Keeping the checklist honest

- Review this file whenever an audit or incident finds a defect it did not catch; add the missing check and its anti-pattern row.
- Prefer automation over memory: when a check can be run by a script or CI job (contrast, target size, axe, Lighthouse, bundle size, forbidden patterns), put it in CI and keep the checkbox here only as a pointer to the job.
