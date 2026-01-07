- Added a snake_case fallback when decoding enriched metadata so `stock_metadata` from Firestore is recognized alongside `stockMetadata` (`models/metadata/EnrichedMetadata.swift`), which restores stock widget data for cards saved with the underscore key.
- Root cause: the client only looked for camelCase `stockMetadata`, so any cards written with `stock_metadata` silently dropped their stock metadata.

Tests not run (not requested).