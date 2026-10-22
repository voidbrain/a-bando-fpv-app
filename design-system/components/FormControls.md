# FormControls

FormControls are the native inputs, styled once globally: `field` fill, `line` border, `radius-control`, 3px × 6px padding.

## Use

- Number inputs are 70px wide by default (`input.mini` = 54px in the options bar).
- Range, checkbox and radio use `accent-color: accent`.
- A checkbox with its label: `<label class="check">`.
- Errors show as `.err` text in `warn` under the field, never as a red border alone.

## Consumer provides

A visible label for every control (a `.fld` caption, a `label.check`, or `aria-label` when the context is unambiguous).

Source: `src/styles.scss (inputs, label.check)`.
