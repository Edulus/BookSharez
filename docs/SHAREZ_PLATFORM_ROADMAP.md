# Sharez Platform Roadmap

**Status:** Long-term direction; begins only after BookSharez validates the
core marketplace loop.

## 1. Vision

BookSharez is the first vertical of a reusable community-commerce platform for
physical collections. The same core should eventually support:

- **CDSharez** — CDs and other physical music releases.
- **DVDSharez** — DVDs, Blu-rays, and other physical video releases.
- **VinylSharez** — vinyl records and collectible pressings.
- **GameSharez** — physical video games across platforms and generations.

Each product keeps the same fundamental loop:

1. Identify an item quickly from a phone.
2. Add it to **Have** or **Want**.
3. List a Have item for sale.
4. Match local supply with community demand.
5. Build identity and conversation around a real collection.

The goal is not four copied websites. It is one proven marketplace engine with
thin, intentional vertical layers.

## 2. Timing Gate

Do not extract a generalized platform merely because the products look
similar. Begin Phase 5 only when BookSharez demonstrates all of the following:

- The capture → shelf → listing loop works reliably with real users.
- Want-match notifications create meaningful marketplace activity.
- The catalog, listing, trust, moderation, and transaction models are stable.
- At least one non-book vertical has validated demand and catalog-data access.
- Maintaining a second vertical by configuration is clearly cheaper than a
  separate implementation.

Until then, BookSharez remains the proving ground and product decisions should
optimize its users rather than an imagined generic framework.

## 3. Shared Core

The reusable platform should own behavior common to every vertical:

- Authentication, profiles, follows, privacy, and community identity.
- Have/Want shelves and collection visibility.
- Listings, conditions, prices, photos, seller trust, and reporting.
- Search result rendering, detail pages, discussions, and notifications.
- Want-match events, moderation, analytics, and operational tooling.
- Mobile capture flow, error handling, accessibility, and deployment patterns.

Shared concepts should use neutral internal names such as `item`, `catalog
record`, `collection entry`, and `listing`. User-facing language remains
vertical-specific: Book, Album, Movie, or Game.

## 4. Vertical Modules

Each Sharez product supplies a vertical definition rather than forking the
core. A definition should provide:

- Brand name, visual theme, icons, copy, and domain.
- Item terminology and collection labels.
- Identifier rules and capture adapters.
- Catalog providers, normalization, enrichment, and affiliate sources.
- Metadata fields, filters, edition/variant identity, and display components.
- Condition vocabulary and pricing inputs.

| Vertical | Primary identifiers | Important metadata |
|---|---|---|
| BookSharez | ISBN-10/13 | Author, edition, publisher, series |
| CDSharez | UPC/EAN, Discogs release ID | Artist, album, label, release/edition |
| DVDSharez | UPC/EAN | Title, format, region, edition, cast/director |
| VinylSharez | UPC/EAN, catalog number | Artist, pressing, speed, size, label |
| GameSharez | UPC/EAN, platform catalog ID | Title, platform, region, edition |

Identifier equality does not always equal work equality. The shared model must
distinguish the abstract work from a sellable edition or release—for example,
the same game on Switch and PlayStation or the same album on CD and vinyl.

## 5. Architecture Direction

The preferred target is a configuration-driven monorepo with clear packages:

```text
apps/
  booksharez/
  cdsharez/
  dvdsharez/
  vinylsharez/
  gamesharez/
packages/
  marketplace-core/
  catalog-contracts/
  ui/
  vertical-book/
  vertical-music/
  vertical-video/
  vertical-game/
```

This is a target shape, not a requirement to migrate frameworks now. The
current vanilla-JS application should first expose clean module boundaries and
neutral domain contracts. Repository or framework migration remains governed
by [GRADUATION_CRITERIA.md](GRADUATION_CRITERIA.md).

The initial deployments may use separate databases for isolation and simpler
operations. A shared account/community network is a later product decision,
not an assumption baked into the first extraction.

## 6. Delivery Phases

### Phase 5A — Define the seam

- Inventory BookSharez-specific names, schemas, providers, and UI assumptions.
- Define `CatalogItem`, `Edition`, `CollectionEntry`, and `Listing` contracts.
- Move branding, terminology, conditions, and provider selection into config.
- Preserve BookSharez behavior with regression tests before extracting code.

### Phase 5B — Prove one second vertical

- Choose the vertical with the strongest user demand and viable catalog API.
- Build it without copying the BookSharez application directory.
- Confirm that shared-core changes can ship to both products safely.
- Measure capture success, listing time, catalog match rate, and Want matches.

### Phase 5C — Productize the platform

- Extract shared packages only where the second vertical proved reuse.
- Add vertical contract tests and cross-app CI.
- Standardize deployment, observability, moderation, and data migrations.
- Document how a new Sharez vertical is scaffolded and governed.

### Phase 5D — Expand deliberately

- Launch additional verticals one at a time.
- Keep edition identity and catalog quality vertical-owned.
- Consider unified accounts, discovery, and cross-collection profiles only
  after separate products show real overlapping usage.

## 7. Non-Goals

- Rebranding every noun before BookSharez works.
- Forcing unlike media into a lowest-common-denominator schema.
- Sharing one production database by default.
- Launching several empty marketplaces simultaneously.
- Forking the repository per vertical and allowing silent divergence.

## 8. Decision Record

**July 10, 2026:** BookSharez is designated the proving ground for a future
Sharez platform. CDSharez, DVDSharez, VinylSharez, and GameSharez are named
candidate verticals. Platform extraction is Phase 5 and is gated by BookSharez
validation plus evidence from a second vertical.
