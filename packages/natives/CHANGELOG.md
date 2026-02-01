# Changelog

## [Unreleased]
### Added

- Exported `fuzzyFind` function for fuzzy file path search with gitignore support
- Exported `FuzzyFindOptions`, `FuzzyFindMatch`, and `FuzzyFindResult` types for fuzzy search API
- Added `fuzzyFind` export for fuzzy file path search with gitignore support

### Fixed

- Fixed potential crashes when updating native binaries by using safe copy strategy that avoids overwriting in-memory binaries
