"""
Builds the letterhead artwork in backend/assets/letterheads/<company-code>/ from the approved design PDFs.
Not used by the app at runtime; kept so the assets can be rebuilt, or a new design added the same way.

    python -I build_assets.py <folder with the design PDFs> <backend/assets/letterheads> [<folder for check images>]

Needs PyMuPDF (pip install pymupdf).

How:
- The design PDFs contain sample letter text, so every text object (BT ... ET) is removed from the page and from
  all nested form XObjects, and the images that only hold text shadows are dropped. What is left is pure artwork.
- Header and footer bands are rendered from that text-free page at 300 dpi. They are opaque crops; the app draws
  them before any text, so text may overlap them as it does in the designs.
- Logos and watermarks are the embedded images, saved as PNG with their soft masks (transparency) applied.
- Shapes that are plain vector paths (the SMB DigitalZone band and corners) are exported as path data to
  shapes.json and redrawn by PDFKit, so they stay sharp.
"""
import json
import os
import re
import sys

import fitz  # PyMuPDF

DPI = 300

# company code -> design file, crops (PDF points, top-left origin; None = page edge),
# images to export (name -> xref), image XObjects to drop (text shadows)
DESIGNS = {
    'axis-aura': {
        'file': 'Axis-Aura.pdf',
        'crops': {'header': (0, 0, None, 142), 'footer': (0, 674, None, None)},
        'images': {'watermark': 51},
        'drop': [],
    },
    'smb-proptech': {
        'file': 'Axis-Proptech.pdf',
        'crops': {'header': (0, 0, None, 193), 'footer': (0, 634, None, None)},
        'images': {'watermark': 64, 'band': 58},
        'drop': ['x4', 'x5', 'x6', 'x7', 'x8', 'x9', 'x10'],
        # the underline of the sample website address (thin vector bars); the app underlines the real one
        'erase_paths': [(360, 779, 540, 782.5)],
    },
    'smb-digitalzone': {
        'file': 'SMB-DigitalZone.pdf',
        'crops': {},
        'images': {'logo': 88, 'watermark': 86},
        'drop': [],
        'shapes': True,
    },
}


def forms_in(doc, xref):
    """Form XObjects referenced from an object (directly or through a resource dictionary)."""
    found = []
    for ref in re.findall(r'(\d+) 0 R', doc.xref_object(xref, compressed=True)):
        obj = doc.xref_object(int(ref), compressed=True)
        if '/Subtype/Form' in obj:
            found.append(int(ref))
        elif obj.startswith('<<') and '/Subtype' not in obj and '/Type' not in obj:
            for sub in re.findall(r'(\d+) 0 R', obj):
                if '/Subtype/Form' in doc.xref_object(int(sub), compressed=True):
                    found.append(int(sub))
    return found


def strip_text(doc, page, drop):
    seen = set()

    def clean(xref):
        if xref in seen:
            return
        seen.add(xref)
        raw = doc.xref_stream(xref)
        if raw is not None:
            new = re.sub(rb'\bBT\b.*?\bET\b', b'', raw, flags=re.S)
            for name in drop:
                new = re.sub(rb'/' + name.encode() + rb'\s+Do\b', b'', new)
            if new != raw:
                doc.update_stream(xref, new)
        for form in forms_in(doc, xref):
            clean(form)

    for c in page.get_contents():
        clean(c)
    res = doc.xref_get_key(page.xref, 'Resources')
    refs = re.findall(r'(\d+) 0 R', res[1])
    for ref in refs:
        for form in forms_in(doc, int(ref)):
            clean(form)
    for form in forms_in(doc, page.xref):
        clean(form)


def image_png(doc, xref):
    pix = fitz.Pixmap(doc, xref)
    if pix.alpha:
        pix = fitz.Pixmap(pix, 0)
    if pix.colorspace and pix.colorspace.n != 3:
        pix = fitz.Pixmap(fitz.csRGB, pix)
    smask = doc.xref_get_key(xref, 'SMask')
    if smask[0] == 'xref':
        pix = fitz.Pixmap(pix, fitz.Pixmap(doc, int(smask[1].split()[0])))
    return pix


def color_hex(c):
    return '#%02x%02x%02x' % tuple(round(v * 255) for v in c)


def pt(p):
    return [round(p.x, 2), round(p.y, 2)]


def export_shapes(page):
    """Filled vector paths, except the page background and the bullets of the sample text."""
    W, H = page.rect.width, page.rect.height
    shapes = []
    groups = []   # (level, opacity) of the transparency groups around the current item
    for d in page.get_drawings(extended=True):
        level = d.get('level', 0)
        while groups and groups[-1][0] >= level:
            groups.pop()
        if d.get('type') == 'group':
            groups.append((level, d.get('opacity') or 1))
            continue
        if d.get('type') == 'clip':
            continue
        group_opacity = 1
        for _, o in groups:
            group_opacity *= o
        r = d['rect']
        if not d.get('fill') or (r.width >= W - 1 and r.height >= H - 1):
            continue
        if r.width < 6 and r.height < 6:
            continue
        ops = []
        last = None
        for it in d['items']:
            kind = it[0]
            if kind in ('l', 'c'):
                start = it[1]
                if last is None or abs(last.x - start.x) > 0.01 or abs(last.y - start.y) > 0.01:
                    ops.append(['M'] + pt(start))
                if kind == 'l':
                    ops.append(['L'] + pt(it[2]))
                    last = it[2]
                else:
                    ops.append(['C'] + pt(it[2]) + pt(it[3]) + pt(it[4]))
                    last = it[4]
            elif kind == 're':
                q = it[1]
                ops.append(['R', round(q.x0, 2), round(q.y0, 2), round(q.width, 2), round(q.height, 2)])
                last = None
            elif kind == 'qu':
                q = it[1]
                ops += [['M'] + pt(q.ul), ['L'] + pt(q.ur), ['L'] + pt(q.lr), ['L'] + pt(q.ll), ['Z']]
                last = None
        # A full-width rectangle is the header band; continuation pages leave it out.
        is_band = len(ops) == 1 and ops[0][0] == 'R' and r.width >= W - 1
        shapes.append({
            'role': 'band' if is_band else 'decoration',
            'fill': color_hex(d['fill']),
            'opacity': round((d.get('fill_opacity') or 1) * group_opacity, 3),
            'evenOdd': bool(d.get('even_odd')),
            'ops': ops,
        })
    return shapes


def main(src, out, check_dir=None):
    for code, cfg in DESIGNS.items():
        dest = os.path.join(out, code)
        os.makedirs(dest, exist_ok=True)
        doc = fitz.open(os.path.join(src, cfg['file']))
        page = doc[0]
        W, H = page.rect.width, page.rect.height

        for name, xref in cfg['images'].items():
            pix = image_png(doc, xref)
            if name == 'band':
                pix.shrink(2)   # a smooth horizontal gradient; a quarter of the pixels is plenty for a thin strip
            pix.save(os.path.join(dest, f'{name}.png'))
        if cfg.get('shapes'):
            with open(os.path.join(dest, 'shapes.json'), 'w') as f:
                json.dump(export_shapes(page), f, separators=(',', ':'))

        strip_text(doc, page, cfg['drop'])
        for rect in cfg.get('erase_paths', []):
            page.add_redact_annot(fitz.Rect(*rect), fill=False)
        if cfg.get('erase_paths'):
            page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE, graphics=fitz.PDF_REDACT_LINE_ART_REMOVE_IF_COVERED)
        for name, (x0, y0, x1, y1) in cfg['crops'].items():
            clip = fitz.Rect(x0, y0, W if x1 is None else x1, H if y1 is None else y1)
            page.get_pixmap(dpi=DPI, clip=clip).save(os.path.join(dest, f'{name}.png'))
        if check_dir:
            page.get_pixmap(dpi=100).save(os.path.join(check_dir, f'{code}-textfree.png'))
        print('built', code, sorted(os.listdir(dest)))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)
