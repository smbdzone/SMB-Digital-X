import { AppError } from '../utils/http.js';
// Register this LAST in index.ts. Express 5 forwards rejected promises from async
// handlers here automatically, so controllers can simply `throw`.
export const errorHandler = (err, _req, res, _next) => {
    if (err instanceof AppError) {
        res.status(err.status).json({ success: false, message: err.message, details: err.details });
        return;
    }
    if (err?.type === 'entity.parse.failed') {
        res.status(400).json({ success: false, message: 'Request body is not valid JSON' });
        return;
    }
    if (err?.name === 'ValidationError' && err.errors) {
        const details = Object.values(err.errors).map((e) => e.message);
        res.status(400).json({ success: false, message: details[0] ?? 'Validation failed', details });
        return;
    }
    if (err?.name === 'CastError') {
        res.status(400).json({ success: false, message: `Invalid value for ${err.path}` });
        return;
    }
    if (err?.code === 11000) {
        res.status(409).json({ success: false, message: 'A record with these details already exists' });
        return;
    }
    if (err?.name === 'MulterError') {
        res.status(400).json({ success: false, message: err.message });
        return;
    }
    console.error('Unhandled error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
};
