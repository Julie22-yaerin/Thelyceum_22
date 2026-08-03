# Fonts

`tt-norms-pro-regular.woff2` (weight 400) and `tt-norms-pro-semibold.woff2`
(weight 600) go here. TT Norms Pro is a licensed commercial typeface — its
files aren't in this repo. `src/index.css` already points `@font-face` at
this folder, so dropping the two files in is the only step; until then the
system-font fallback in the stack renders instead.
