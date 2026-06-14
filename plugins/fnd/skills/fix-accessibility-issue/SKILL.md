---
name: fix-accessibility-issue
description: >
  Analyze and fix accessibility issues in theme components, following the standard issue-fix workflow
  with a11y-specific ARIA, focus-management, and screen-reader considerations. Use when the user asks
  to fix an accessibility / a11y / ARIA / keyboard / screen-reader / focus issue in a component, or
  references a GitHub accessibility issue, or invokes /fix-accessibility-issue.
argument-hint: "<component-name | GitHub issue #>"
arguments:
  - name: target
    description: The component to fix (e.g. mega-menu, cart-drawer) or a GitHub accessibility issue number.
allowed-tools: Read, Glob, Grep, Edit, Bash(npx playwright test*)
---

# Fix Accessibility Issue

Fix accessibility issues in theme components. Follow the standard issue-fix workflow (branch → implement → test → commit), with the a11y-specific rules below.

## Component ARIA patterns

Before implementing, **search the codebase for the existing ARIA pattern** for the component type (`Grep` for `role=`, `aria-*`, and the component name), and follow the **WCAG ARIA Authoring Practices (APG)** pattern for that widget. Common component types in this theme:

`accordion · breadcrumb · carousel/slider · cart-drawer · color-swatch · combobox/dropdown · disclosure · dropdown-navigation · modal/dialog · product-card · product-filter · sale-price · switch · tab · tooltip`

Match the existing repo pattern first; reach for the APG spec when there's no precedent.

## Critical implementation rules

- **`role` goes on the element that contains the items**, not the wrapper — screen readers need a direct parent-child relationship between the role and its items.
- **Test with an actual screen reader / accessibility tree**, not just markup validation. Verify individual items are recognized, not just containers.
- **Update page-object models** when changing roles (e.g. `navigation` → `menubar`).
- **Test focus thoroughly** — navigate away and back; focus bugs look correct but misbehave on subsequent interactions.

## Focus management

- Consistent focus behaviour across keyboard and mouse.
- Reset focus state properly when closing dropdowns/menus (ESC vs selection).
- Centralize focus-management logic — don't duplicate it across handlers.

## Implementation guidelines

- Search for existing ARIA patterns first; make **minimal** changes; favour semantic correctness over visual change; keep backward compatibility.
- Don't over-engineer — native browser behaviour (`<details>`, `<dialog>`, `popover`) often suffices.
- Use `aria-labelledby` to reference existing visible text instead of duplicating it in `aria-label`.
- Avoid duplicate logic between keyboard and mouse handlers; separate ARIA-state management from focus management.

## Performance

- Complex keyboard navigation can introduce lag — test on slower devices; prefer simpler solutions before custom keyboard handling.

## Testing

- Run the relevant test suite (`npx playwright test --reporter=line`); update selectors / page objects when roles change. Verify with the accessibility tree, then record learnings.
