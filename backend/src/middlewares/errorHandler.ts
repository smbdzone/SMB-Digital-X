import { ErrorRequestHandler } from 'express'
import { AppError } from '../utils/http.js'

// Register this LAST in index.ts. Express 5 forwards rejected promises from async
// handlers here automatically, so controllers can simply `throw`.
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof AppError) {
        res.status(err.status).json({ success: false, message: err.message, details: err.details })
        return
    }

    // Body-parser errors: never logged (a parse error carries the raw request body, which can hold a signature image).
    if (err?.type === 'entity.too.large') {
        res.status(413).json({ success: false, message: 'The request is too large. A signature image must be at most 1 MB.' })
        return
    }

    if (err?.type === 'entity.parse.failed') {
        res.status(400).json({ success: false, message: 'Request body is not valid JSON' })
        return
    }

    if (err?.name === 'ValidationError' && err.errors) {
        const details = Object.values(err.errors).map((e: any) => e.message)
        res.status(400).json({ success: false, message: details[0] ?? 'Validation failed', details })
        return
    }

    if (err?.name === 'CastError') {
        res.status(400).json({ success: false, message: `Invalid value for ${err.path}` })
        return
    }

    if (err?.code === 11000) {
        res.status(409).json({ success: false, message: 'A record with these details already exists' })
        return
    }

    if (err?.name === 'MulterError') {
        res.status(400).json({ success: false, message: err.message })
        return
    }

    // Log what went wrong, never the error object itself: some errors carry the request body or other data.
    console.error('Unhandled error:', err?.name ?? 'Error', err?.message ?? '', err?.stack ?? '')
    res.status(500).json({ success: false, message: 'Internal server error' })
}
