# Vendored fonts

These TrueType files are used **only** server-side, when `DocumentOgImage`
rasterizes the document social-preview SVG through `ruby-vips`/librsvg. librsvg
resolves fonts through fontconfig, so `config/initializers/og_image_fonts.rb`
registers this directory with fontconfig at boot (via a generated
`FONTCONFIG_FILE`). They are not part of the Vite frontend bundle.

| File | Family | Source | License |
| --- | --- | --- | --- |
| `Newsreader[opsz,wght].ttf` | Newsreader | [google/fonts](https://github.com/google/fonts/tree/main/ofl/newsreader) | SIL OFL 1.1 (`Newsreader-OFL.txt`) |
| `InstrumentSans[wght].ttf` | Instrument Sans | [google/fonts](https://github.com/google/fonts/tree/main/ofl/instrumentsans) | SIL OFL 1.1 (`InstrumentSans-OFL.txt`) |

Both are variable fonts; librsvg selects the requested weight from the `wght`
axis. Replacing them: drop in the upstream variable TTF, keep the `Family`
name identical, and update the license file.
