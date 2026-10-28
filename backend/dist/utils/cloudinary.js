import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';
dotenv.config();
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});
export const uploadToCloudinary = (fileBuffer, options = {}) => {
    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream({
            folder: options.folder || 'chat_attachments',
            resource_type: options.resource_type || 'auto',
            use_filename: true,
            unique_filename: true,
            filename_override: options.filename,
        }, (error, result) => {
            if (error) {
                reject(error);
            }
            else if (result) {
                resolve({
                    url: result.secure_url,
                    public_id: result.public_id,
                    resource_type: result.resource_type,
                });
            }
            else {
                reject(new Error('Upload failed'));
            }
        });
        uploadStream.end(fileBuffer);
    });
};
export const deleteFromCloudinary = (public_id, resource_type = 'image') => {
    return cloudinary.uploader.destroy(public_id, { resource_type });
};
export default cloudinary;
