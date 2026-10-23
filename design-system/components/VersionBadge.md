# VersionBadge

VersionBadge shows the build number bottom-left, above everything (`z-badge`), with the language flag beside it.

## Use

- The number: `badge` type style, `badge-ink` on `badge`, `radius`. The commit sha is its `title`. No pointer events.
- The flag: a small round button on the same `badge` background, showing the current language's flag. It opens a menu
  above it (`panel-solid`, `line` border, `radius-menu`, `shadow-menu`) of flags and language names, written in their
  own language and never translated (`translate="no"`). The current one has an `accent` border. Esc or a click
  outside closes it; focus shows the 2px `accent` outline.
- Flags are pictures: their colours are the national ones, not tokens. This is the one place literal colours are
  allowed outside the token set.

## Consumer provides

Nothing: the deploy workflow bumps the number; `I18nService` holds the language.

Source: `src/app/ui/version-badge.ts`.
