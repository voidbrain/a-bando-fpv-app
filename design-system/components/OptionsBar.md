# OptionsBar

OptionsBar is the chip bar beside the palette holding the active tool's options.

## Use

- One `.opts` box on `panel-solid`, `radius-menu`; options grouped in `.grp` with a 4px gap, groups 10px apart.
- Small numeric fields use `input.mini` (54px); two or three short choices use a `.seg`; a choice between kinds of
  things (structure kinds, tree species, fence materials, brush shapes) uses a PickMenu with a picture per option.
- Show only the active tool's options. Select has its own (box / lasso, magnet).
- It opens beside the active tool's button, on the side of the palette with more room (right by default), at the same
  height. Its grip drags it elsewhere (remembered as `abando-float-opts`); double-click the grip to put it back beside
  the tool. It joins the shared stacking order and comes on top when a tool is picked or it is clicked.

## Consumer provides

The options of the active tool and their bindings.

Source: `src/app/ui/studio/bando-editor.scss (.opts)`.
