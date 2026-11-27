/*
 * Ported from frontend/lib/signatureClean.ts (same algorithm, types removed).
 * Prepares the owner's signature image in the browser before it is sent:
 *   1. near-white / light-grey background -> transparent (threshold with a soft edge, so the ink stays smooth),
 *   2. faint specks removed,
 *   3. cropped to the ink with a small padding.
 *
 * Memory only: an off-screen canvas that is never attached to the page, no storage of any kind.
 * The result is exactly what is printed, so the preview shows this processed image.
 */


/** Same limits as the server (backend/src/utils/signatureImage.ts). */
export const SIGNATURE_PIXEL_LIMITS = { minWidth: 60, maxWidth: 3000, minHeight: 20, maxHeight: 2000, maxBytes: 1024 * 1024 }

// Big photos are scaled down first: plenty for a signature box a few centimetres wide, and keeps the PNG small.
const WORK_MAX_WIDTH = 1800
const WORK_MAX_HEIGHT = 1000

const luminance = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b
const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v)

/**
 * Local paper colour, per pixel: photos are lit unevenly (shadows, vignetting), so one global threshold would
 * leave grey patches. The picture is cut into blocks; each block's paper colour is its 90th-percentile
 * brightness (ink is darker and covers a minority of a block). The grid is spread with a 3x3 maximum (so a
 * block full of ink takes its neighbours' paper), smoothed with a 3x3 mean, and interpolated bilinearly.
 */
const paperMap = (data, width, height) => {
    const B = Math.max(16, Math.round(Math.max(width, height) / 48))
    const gw = Math.ceil(width / B), gh = Math.ceil(height / B)
    const grid = new Float32Array(gw * gh * 4)          // r, g, b, luminance per block
    const hist = new Uint32Array(256)
    for (let by = 0; by < gh; by++) {
        for (let bx = 0; bx < gw; bx++) {
            hist.fill(0)
            let count = 0
            const xs = bx * B, ys = by * B, xe = Math.min(width, xs + B), ye = Math.min(height, ys + B)
            for (let y = ys; y < ye; y++) for (let x = xs; x < xe; x++) {
                const p = (y * width + x) * 4
                hist[Math.round(luminance(data[p], data[p + 1], data[p + 2]))]++
                count++
            }
            let level = 255
            for (let v = 255, seen = 0; v >= 0; v--) { seen += hist[v]; if (seen >= count * 0.1) { level = v; break } }
            // average colour of the pixels at or above that level = the paper's colour in this block
            let r = 0, g = 0, b = 0, m = 0
            for (let y = ys; y < ye; y++) for (let x = xs; x < xe; x++) {
                const p = (y * width + x) * 4
                if (luminance(data[p], data[p + 1], data[p + 2]) >= level - 0.5) { r += data[p]; g += data[p + 1]; b += data[p + 2]; m++ }
            }
            const q = (by * gw + bx) * 4
            grid[q] = r / m; grid[q + 1] = g / m; grid[q + 2] = b / m; grid[q + 3] = level
        }
    }
    const filter = (src, pick) => {
        const out = new Float32Array(src.length)
        for (let by = 0; by < gh; by++) for (let bx = 0; bx < gw; bx++) {
            const q = (by * gw + bx) * 4
            let best = -1, sum = [0, 0, 0, 0], k = 0
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                const x = bx + dx, y = by + dy
                if (x < 0 || y < 0 || x >= gw || y >= gh) continue
                const o = (y * gw + x) * 4
                if (pick === 'max') { if (src[o + 3] > best) { best = src[o + 3]; sum = [src[o], src[o + 1], src[o + 2], src[o + 3]] } }
                else { for (let c = 0; c < 4; c++) sum[c] += src[o + c]; k++ }
            }
            for (let c = 0; c < 4; c++) out[q + c] = pick === 'max' ? sum[c] : sum[c] / k
        }
        return out
    }
    const smooth = filter(filter(grid, 'max'), 'mean')

    const map = new Float32Array(width * height * 4)
    for (let y = 0; y < height; y++) {
        const gy = Math.min(gh - 1, Math.max(0, (y + 0.5) / B - 0.5)), y0 = Math.floor(gy), y1 = Math.min(gh - 1, y0 + 1), fy = gy - y0
        for (let x = 0; x < width; x++) {
            const gx = Math.min(gw - 1, Math.max(0, (x + 0.5) / B - 0.5)), x0 = Math.floor(gx), x1 = Math.min(gw - 1, x0 + 1), fx = gx - x0
            const p = (y * width + x) * 4
            for (let c = 0; c < 4; c++) {
                const a = smooth[(y0 * gw + x0) * 4 + c] * (1 - fx) + smooth[(y0 * gw + x1) * 4 + c] * fx
                const b = smooth[(y1 * gw + x0) * 4 + c] * (1 - fx) + smooth[(y1 * gw + x1) * 4 + c] * fx
                map[p + c] = a * (1 - fy) + b * fy
            }
        }
    }
    return map
}

/** Removes ink blobs smaller than `minArea` pixels (dust, JPEG noise, specks). 8-connected. */
const removeSpecks = (data, width, height, minArea) => {
    const n = width * height
    const seen = new Uint8Array(n)
    const queue = new Int32Array(n)
    for (let start = 0; start < n; start++) {
        if (seen[start] || data[start * 4 + 3] < 40) continue
        let head = 0, tail = 0
        queue[tail++] = start
        seen[start] = 1
        while (head < tail) {
            const i = queue[head++], x = i % width, y = (i - x) / width
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                const nx = x + dx, ny = y + dy
                if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
                const j = ny * width + nx
                if (!seen[j] && data[j * 4 + 3] >= 40) { seen[j] = 1; queue[tail++] = j }
            }
        }
        if (tail < minArea) for (let k = 0; k < tail; k++) data[queue[k] * 4 + 3] = 0
    }
    // Faint pixels (alpha below 40) only belong to the ink's soft edge: clear the ones next to no ink.
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const p = (y * width + x) * 4 + 3
        if (data[p] === 0 || data[p] >= 40) continue
        let touches = false
        for (let dy = -1; dy <= 1 && !touches; dy++) for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy
            if (nx >= 0 && ny >= 0 && nx < width && ny < height && data[(ny * width + nx) * 4 + 3] >= 40) { touches = true; break }
        }
        if (!touches) data[p] = 0
    }
}

/**
 * The pixel work. Pure (no DOM), so it can be tested on its own.
 *
 * - Images with their own transparency (a prepared PNG) keep their colours; faint specks are removed.
 * - Images with a background (a photo or scan): each pixel is compared with the LOCAL paper colour (see
 *   paperMap). At 90% of the paper's brightness or more it becomes transparent, at 60% or less it stays solid,
 *   with a linear ramp in between for a soft edge. Partly transparent pixels get the paper's share of the
 *   colour taken out ("colour to alpha"), so the ink keeps no light halo.
 * - Then small specks are removed and the image is cropped to the ink with a small padding.
 */
export const cleanSignaturePixels = (src) => {
    const { width, height } = src
    const n = width * height
    const data = new Uint8ClampedArray(src.data)

    let transparent = 0
    for (let i = 0; i < n; i++) if (data[i * 4 + 3] < 16) transparent++
    const hasOwnAlpha = transparent > n * 0.2

    if (!hasOwnAlpha) {
        const paper = paperMap(data, width, height)
        const HI = 0.9, LO = 0.6
        for (let i = 0; i < n; i++) {
            const p = i * 4
            const r = data[p], g = data[p + 1], b = data[p + 2]
            const ratio = luminance(r, g, b) / Math.max(1, paper[p + 3])
            const k = ratio >= HI ? 0 : ratio <= LO ? 1 : (HI - ratio) / (HI - LO)
            if (k > 0 && k < 1) {
                data[p] = clamp255((r - paper[p] * (1 - k)) / k)
                data[p + 1] = clamp255((g - paper[p + 1] * (1 - k)) / k)
                data[p + 2] = clamp255((b - paper[p + 2] * (1 - k)) / k)
            }
            data[p + 3] = Math.round(data[p + 3] * k)
        }
        paper.fill(0)
    } else {
        // Already transparent: drop faint specks (alpha below 40), soften alpha 40..100 so edges stay smooth.
        for (let i = 0; i < n; i++) {
            const p = i * 4 + 3
            const a = data[p]
            data[p] = a < 40 ? 0 : a < 100 ? Math.round((a * (a - 40)) / 60) : a
        }
    }

    // Anything almost invisible is noise, not ink; so are tiny isolated blobs.
    for (let i = 0; i < n; i++) if (data[i * 4 + 3] < 24) data[i * 4 + 3] = 0
    removeSpecks(data, width, height, Math.max(12, Math.round(n * 0.00002)))

    // Bounding box of the ink.
    let x0 = width, y0 = height, x1 = -1, y1 = -1
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (data[(y * width + x) * 4 + 3] >= 40) {
                if (x < x0) x0 = x
                if (x > x1) x1 = x
                if (y < y0) y0 = y
                if (y > y1) y1 = y
            }
        }
    }
    if (x1 < 0) throw new Error('No signature found in the image. Use a clear picture of the signature on a light background.')

    // Small padding, then grow to the minimum size the server accepts.
    const pad = Math.max(6, Math.round(Math.max(x1 - x0, y1 - y0) * 0.03))
    let cx0 = Math.max(0, x0 - pad), cy0 = Math.max(0, y0 - pad)
    let cx1 = Math.min(width - 1, x1 + pad), cy1 = Math.min(height - 1, y1 + pad)
    const grow = (a0, a1, min, size) => {
        let need = min - (a1 - a0 + 1)
        while (need > 0 && (a0 > 0 || a1 < size - 1)) {
            if (a0 > 0) { a0--; need-- }
            if (need > 0 && a1 < size - 1) { a1++; need-- }
        }
        return [a0, a1]
    }
    ;[cx0, cx1] = grow(cx0, cx1, SIGNATURE_PIXEL_LIMITS.minWidth, width)
    ;[cy0, cy1] = grow(cy0, cy1, SIGNATURE_PIXEL_LIMITS.minHeight, height)

    const outW = cx1 - cx0 + 1, outH = cy1 - cy0 + 1
    if (outW < SIGNATURE_PIXEL_LIMITS.minWidth || outH < SIGNATURE_PIXEL_LIMITS.minHeight) {
        throw new Error('The signature is too small. Use a larger picture.')
    }
    const out = new Uint8ClampedArray(outW * outH * 4)
    for (let y = 0; y < outH; y++) {
        const from = ((cy0 + y) * width + cx0) * 4
        out.set(data.subarray(from, from + outW * 4), y * outW * 4)
    }
    return { data: out, width: outW, height: outH }
}

/** Decodes, cleans and re-encodes the picked file as PNG, entirely in memory. */
export const processSignatureFile = async (file) => {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, WORK_MAX_WIDTH / bitmap.width, WORK_MAX_HEIGHT / bitmap.height)
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))

    // Off-screen canvas: created in memory, never added to the page.
    const canvas = document.createElement('canvas')
    try {
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) throw new Error('This browser cannot process images.')
        ctx.drawImage(bitmap, 0, 0, w, h)

        const cleaned = cleanSignaturePixels({ data: ctx.getImageData(0, 0, w, h).data, width: w, height: h })
        canvas.width = cleaned.width
        canvas.height = cleaned.height
        ctx.putImageData(new ImageData(cleaned.data, cleaned.width, cleaned.height), 0, 0)
        cleaned.data.fill(0)

        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
        if (!blob) throw new Error('Could not prepare the signature image.')
        if (blob.size > SIGNATURE_PIXEL_LIMITS.maxBytes) throw new Error('The signature image is too large after processing. Use a smaller picture.')
        return { blob, width: cleaned.width, height: cleaned.height }
    } finally {
        // Release the pixel memory right away.
        bitmap.close()
        canvas.width = 0
        canvas.height = 0
    }
}
