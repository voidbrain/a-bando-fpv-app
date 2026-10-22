# InspectorSection

InspectorSection groups the selected element's properties: an uppercase caption, then fields two to a row.

## Use

- `<div class="sec">` with a `.st` caption (`section-label` style, dim, uppercase) and `.fld` labels each wrapping its control.
- A `.span2` field or a `.row` takes the whole width; `.sec.acts` is a flex row of buttons at the end.
- Sections are separated by their own top rule (`line`), not by cards or backgrounds.
- Units go in the label ("Height (m)"), not in the input.

## Consumer provides

The caption, the fields and their bindings. Keep each section to one concern (Size, Floors, Openings, Modules).

Source: `src/app/ui/studio/bando-editor.ts (.sec, .st, .fld)`.
