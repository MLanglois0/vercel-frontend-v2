import { S3Client } from '@aws-sdk/client-s3'

if (!process.env.R2_ACCESS_KEY_ID) throw new Error('Missing R2_ACCESS_KEY_ID')
if (!process.env.R2_SECRET_ACCESS_KEY) throw new Error('Missing R2_SECRET_ACCESS_KEY')
if (!process.env.R2_ACCOUNT_ID) throw new Error('Missing R2_ACCOUNT_ID')
if (!process.env.R2_BUCKET_NAME) throw new Error('Missing R2_BUCKET_NAME')

export const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
})

export const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME 