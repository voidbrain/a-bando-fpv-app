# OptionsBar

OptionsBar is the chip bar beside the palette holding the active tool's options.

## Use

- One `.opts` box on `panel-solid`, `radius-menu`; options grouped in `.grp` with a 4px gap, groups 10px apart.
- Small numeric fields use `input.mini` (54px); choices use a `.seg`.
- Show only the active tool's options; hide the bar when the tool has none.

## Consumer provides

The options of the active tool and their bindings.

Source: `src/app/ui/studio/bando-editor.ts (.opts)`.
