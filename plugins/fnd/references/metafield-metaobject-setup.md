# Metafield / metaobject store setup — inspect, create, mock, bind

Shared reference for `/develop-feature-or-fix` (and the Data / Config section of
`/write-technical-approach`). **When the ticket — or a linked doc (e.g. a Notion data-mapping /
schema page, see `${CLAUDE_PLUGIN_ROOT}/references/reading-linked-docs.md`) — describes a
metafield or metaobject**, the theme code has nothing to render until the store's data model
exists. This is how you get it in place: inspect what's already there, create what's missing in
dependency order, mock content, and bind it to a test product so the feature can be built and QA'd.

Admin GraphQL API (pin the version the repo targets, e.g. `2026-04`). Every mutation must select
`userErrors { field message code }` and the created `id`.

## Two modes

Pick based on whether you have an **Admin API token**:

- **Mode 1 — admin token available.** Run the inspection query **and** all mutations yourself via
  the bundled runner `${CLAUDE_PLUGIN_ROOT}/scripts/shopify-admin-gql.sh` (see **Token & store**
  below). Drive it end to end: inspect → diff → create → mock → bind → report the resulting gids
  and final state. **Treat the token exactly like the Theme Access token — never print it, never
  echo it into context**; the runner consumes it inside the request header only.
- **Mode 2 — no token.** Produce a **single living `.graphql` file** the developer runs by hand in
  the **Shopify GraphiQL App** (Shopify admin → Apps → *Shopify GraphiQL App*). Hand them **one
  step at a time**; they paste back the JSON result, you read the returned **gid**, fill it into
  the next step, mark the step done, and advance. The file is the source of truth and the run log.

Either way the **step skeleton is identical** — only who-runs-it differs.

## Token & store (Mode 1)

The metaobject/metafield mutations need an **Admin API access token** — `shpat_…`, with scopes
`read/write_metaobject_definitions`, `read/write_metaobjects`, `read/write_products`. **This is
NOT the Theme Access token (`shptka_`) in `shopify.theme.toml`** — that one only has `write_themes`
and can't touch metaobjects. Get the admin token from a **custom app** in the Shopify admin
(Settings → Apps and sales channels → Develop apps → your app → API credentials → Admin API access
token).

Where it lives: the repo's **gitignored `.env`**, as **`SHOPIFY_ADMIN_TOKEN=shpat_…`**. (If the dev
hasn't added it yet, ask them to put that line in `.env` — alongside the existing `BRAND` /
`FIGMA_TOKEN`.) **Never `Read` `.env` yourself** — that pulls the secret into context. Instead run:

```bash
${CLAUDE_PLUGIN_ROOT}/scripts/shopify-admin-gql.sh --query docs/<TICKET>-inspection.graphql [--operation <Name>]
```

The runner reads `SHOPIFY_ADMIN_TOKEN` straight from `.env` into the request header (never printed),
takes the store domain from `shopify.theme.toml`'s `store=` line, and prints only the JSON response.
Put each query/mutation in a `.graphql` file and pass it with `--query` (and `--operation` when the
file holds several named operations). If the runner prints `error=no_admin_token`, the token isn't
set — tell the dev to add it to `.env`, or fall back to **Mode 2**.

## Step skeleton (dependency order)

Derived from the ELC-257 worked example (`pdp_split_view_block` → `pdp_editorial_content` wrapper →
product metafield → mock instances → product bind):

- **STEP 0 — INSPECT what exists.** A read query covering: the target metaobject definition(s) by
  type (`metaobjectDefinitionByType(type: "…")`), any wrapper/parent they attach to, a broad
  `metaobjectDefinitions(first: 100)` to catch naming variance, and the owner
  `metafieldDefinitions(ownerType: …, namespace: "…")`. **Diff the result against the data-mapping
  doc / TA** to decide which of the steps below are actually needed (some may already exist).
- **STEP 1 — CREATE the child metaobject definition** (`metaobjectDefinitionCreate`). Field set
  comes from the data-mapping doc. Use `validations: [{ name: "choices", value: "[\"…\"]" }]` to
  constrain content-team values to what the Liquid switches on; set `displayNameKey`; enable
  `capabilities` (`translatable` / `publishable`) to match siblings. **Copy the returned gid.**
- **STEP 2 — WIRE it into the wrapper/parent** (`metaobjectDefinitionUpdate` on the wrapper gid):
  append a `metaobject_reference` field validated by
  `{ name: "metaobject_definition_id", value: "<gid from STEP 1>" }`. (Adding a sibling block later
  is this same one-field append.)
- **STEP 3 — CREATE the owner metafield definition** (`metafieldDefinitionCreate`, e.g.
  `ownerType: PRODUCT`), `type: "metaobject_reference"` validated against the wrapper definition
  gid. This is what ties `product.<namespace>.<key>` to the data model. **Copy the returned gid.**
- **STEP 4 — CREATE mock content** for the child (`metaobjectCreate`) using data from the design /
  ticket. **Copy the returned instance gid.** For any image/file field, in priority order:
  1. **Prefer a variant that needs no media** (e.g. `media_type: "video"` with a `video_url`) so
     the step is runnable as-is.
  2. **Reuse existing store media** — query for one (`files(first: 10, query: "media_type:IMAGE")`
     → take a `MediaImage` `id`) and reference that gid. No upload, nobody adds anything.
  3. **Upload a specific new asset** only when the ticket genuinely needs it:
     `stagedUploadsCreate` → PUT the file to the returned target → `fileCreate` → use the resulting
     `MediaImage` gid. In **Mode 1** do this yourself if the asset file is available locally; in
     **Mode 2**, or when you don't have the file, **ask the dev to upload it in the admin (Content →
     Files) and paste the `gid://shopify/MediaImage/<id>` back**. So the dev only ever touches media
     in this last case — not by default.
- **STEP 5 — CREATE the wrapper instance** (`metaobjectCreate` on the wrapper type) binding the
  child reference gid from STEP 4. (If the test product already has a wrapper instance, use
  `metaobjectUpdate` on it instead of creating a new one.) **Copy the returned gid.**
- **STEP 6 — BIND onto a test product** (`metafieldsSet`): set the product `ownerId`
  (`gid://shopify/Product/<id>`, copied from the product's admin URL) and the wrapper instance gid
  from STEP 5 as the metafield value. After this the test product renders the feature.

## The living `.graphql` file (Mode 2)

Write it to `docs/<TICKET-KEY>-metaobject-setup.graphql` (and, if useful, a companion
`-inspection.graphql` for STEP 0). Mirror the ELC-257 file's shape:

- **Header comment block**: API version, the per-step **scopes** required
  (`read/write_metaobject_definitions`, `write_metaobjects`, `read/write_products`), a **diff vs
  the data-mapping doc** (what EXISTS vs MISSING), a **STATUS** list, and a **RUN ORDER** line.
- **One named operation per step** (`query InspectPdpEditorialData`,
  `mutation CreateSplitViewBlockDefinition`, …), each preceded by a comment explaining what it does
  and why.
- **`REPLACE_WITH_*` placeholders** for every gid that comes from an earlier step — and a note that
  each is filled from the prior step's result before running.
- **Update it as you go**: when the developer pastes a result, mark that step `✅ DONE` with the
  returned gid inline, paste the gid into the dependent step(s), and move the RUN ORDER pointer
  forward. Keep it accurate enough that someone could re-run the whole thing from the file alone.

## Verifying data-driven Acceptance Criteria (mutate to test)

When you have the admin token and provisioned the data yourself (Mode 1), many AC are **conditional
on the metafield/metaobject value** — one default render doesn't prove them. Drive each state with
a mutation, verify, then restore:

- **Enumerated options** (e.g. *"media area supports 4:3 / 1:1"*): verify the default, then
  `metaobjectUpdate` / `metafieldsSet` the field to each other value (`1:1`), reload, confirm the UI
  reflects it.
- **Optional / presence-conditional fields** (e.g. *"heading, body, secondary CTA are all optional;
  an unconfigured element shows no empty placeholder"*): clear the field, reload, and **inspect the
  DOM** — confirm the element is genuinely absent, not just visually empty. Repeat per optional
  element.
- Walk **every** enumerated/optional/conditional value an AC names; don't assume a state you didn't
  render.

**Propagation lag:** Shopify can serve a **stale value** for a short window after a mutation. After
mutating, **re-query the value** (a quick read via `shopify-admin-gql.sh`) to confirm it actually
changed, then hard-reload (cache-bust) the storefront. If the UI still shows the old value, wait
briefly and retry **before** concluding the code is wrong — distinguish "not yet propagated" from a
real bug. Leave the data in a known state (restore defaults or note what you left set) so QA starts
clean.

## Plan it in the TA first

In `/write-technical-approach`, the **Data / Config** section should already name the required
metafield/metaobject definitions (types, keys, field list, owner/namespace) and can carry the
STEP 0 inspection query, so `/develop-feature-or-fix` starts from a known target instead of
rediscovering the schema.
