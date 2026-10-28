import multer from 'multer';

// Store files in memory for Cloudinary upload
const storage = multer.memoryStorage();

// Allow every file type
const fileFilter = (
    req: any,
    file: Express.Multer.File,
    cb: multer.FileFilterCallback
) => {
    cb(null, true);
};

export const upload = multer({
    storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB per file
        files: 15,                   // Maximum 15 files
    },
    fileFilter,
});