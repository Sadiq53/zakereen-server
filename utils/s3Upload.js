const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');

const s3Client = new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    }
});

/**
 * Uploads a buffer to S3 and returns the public URL.
 * @param {Buffer} buffer The file buffer to upload
 * @param {string} mimetype The MIME type of the file (e.g. image/jpeg)
 * @param {string} folder The folder prefix in the bucket (e.g. occasions)
 * @returns {Promise<string>} The public URL of the uploaded object
 */
async function uploadToS3(buffer, mimetype, folder = 'uploads') {
    const bucketName = process.env.S3_BUCKET_NAME;
    if (!bucketName) {
        throw new Error('S3_BUCKET_NAME is not defined in environment variables');
    }

    const uniqueId = crypto.randomBytes(8).toString('hex');
    const extension = mimetype.split('/')[1] || 'jpg';
    const key = `${folder}/${Date.now()}-${uniqueId}.${extension}`;

    const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: buffer,
        ContentType: mimetype,
    });

    await s3Client.send(command);

    // Return the formatted URL
    return `https://${bucketName}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${key}`;
}

module.exports = {
    uploadToS3
};
