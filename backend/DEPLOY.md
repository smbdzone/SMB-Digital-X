# Backend deploy notes

- `npm run build` only compiles `src/` to `dist/`. The **`assets/` folder (fonts and letterhead artwork) must be
  included in the deploy bundle**, next to `dist/` (the server reads `backend/assets/...` at runtime).
  Without it, letters for companies with a letterhead fail with "Letterhead files are missing on the server",
  and the server logs a warning at startup.
- Letterhead artwork is built from the approved design PDFs with `scripts/letterheads/build_assets.py`
  (see the comment at the top of that file). Fonts are the official Google Fonts files; their licences are in `assets/fonts/`.
