import { badRequest } from './http.js'

/*
 * The owner's signature image for one issue / bulk issue / resend.
 *
 * It arrives as base64 in the JSON body, is checked here, used in memory to draw the emailed PDF and then wiped.
 * It must never be stored: not in the database, on disk, in Cloudinary, in logs or in error messages.
 * Error messages below therefore never include any part of the data.
 */

export const SIGNATURE_MAX_BYTES = 1024 * 1024           // 1 MB decoded
export const SIGNATURE_LIMITS = { minWidth: 60, maxWidth: 3000, minHeight: 20, maxHeight: 2000 }

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export type SignatureType = 'png' | 'jpeg'

/** Reads width and height from the PNG IHDR chunk or the JPEG start-of-frame marker. */
const imageSize = (buf: Buffer, type: SignatureType): { width: number; height: number } | null => {
    if (type === 'png') {
        // signature (8) + chunk length (4) + "IHDR" (4) + width (4) + height (4)
        if (buf.length < 24 || buf.toString('latin1', 12, 16) !== 'IHDR') return null
        return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
    }
    let i = 2
    while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) return null
        const marker = buf[i + 1]
        if (marker === 0xff) { i += 1; continue }                 // fill byte
        if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue }
        const length = buf.readUInt16BE(i + 2)
        // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC)
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
            return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
        }
        if (marker === 0xd9 || marker === 0xda) return null           // end of image / start of scan before a frame
        i += 2 + length
    }
    return null
}

/**
 * Validates `signatureImage` from a request body: base64 (a "data:image/...;base64," prefix is allowed),
 * PNG or JPEG by magic bytes (the extension and the declared type are ignored), at most 1 MB, sensible pixel size.
 * Returns undefined when no signature was sent.
 */
export const parseSignatureImage = (value: unknown): { image: Buffer; type: SignatureType } | undefined => {
    if (value === undefined || value === null || value === '') return undefined
    if (typeof value !== 'string') throw badRequest('signatureImage must be a base64 encoded PNG or JPEG image')

    const base64 = value.replace(/^data:[^;,]{0,100};base64,/, '').replace(/\s+/g, '')
    if (base64.length > Math.ceil(SIGNATURE_MAX_BYTES / 3) * 4 + 4) throw badRequest('The signature image must be at most 1 MB')
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw badRequest('signatureImage must be a base64 encoded PNG or JPEG image')

    const image = Buffer.from(base64, 'base64')
    if (image.length === 0) throw badRequest('signatureImage must be a base64 encoded PNG or JPEG image')
    if (image.length > SIGNATURE_MAX_BYTES) { image.fill(0); throw badRequest('The signature image must be at most 1 MB') }

    const type: SignatureType | null = image.subarray(0, 8).equals(PNG_MAGIC) ? 'png'
        : image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff ? 'jpeg'
            : null
    if (!type) { image.fill(0); throw badRequest('The signature must be a PNG or JPEG image') }

    const size = imageSize(image, type)
    const L = SIGNATURE_LIMITS
    if (!size || size.width < L.minWidth || size.width > L.maxWidth || size.height < L.minHeight || size.height > L.maxHeight) {
        image.fill(0)
        throw badRequest(`The signature image must be between ${L.minWidth}x${L.minHeight} and ${L.maxWidth}x${L.maxHeight} pixels`)
    }
    return { image, type }
}

/** Overwrites the bytes so no copy of the signature lingers in this buffer after use. */
export const wipe = (image?: Buffer): void => {
    image?.fill(0)
}
