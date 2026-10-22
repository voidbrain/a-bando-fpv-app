# ElementsList

ElementsList lists every element of the site by category or as a tree, with outline thumbnails and counts.

## Use

- `.tabs` on top, then collapsible groups (`details` with ▸ / ▾ in `dim`) carrying a `.cnt` pill.
- Rows (`.el-row`; `.row` in the app) are 30px thumbnail + name + secondary text; hover `rgba(255,255,255,.06)`, selected = `accent` border. Nested rows use `.sub`.
- Thumbnails draw the building outline in `text` on `thumb`; structures show a glyph. Columns are never listed one by one, trees are grouped in zones.

## Consumer provides

The site spec and the selected id; it emits where to go when a row is clicked.

Source: `src/app/ui/studio/elements-box.ts`.
