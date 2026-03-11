import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

const router: Router = Router();

// Get the correct path for uploads directory
const getUploadsDir = () => {
    // In development, uploads is in the backend folder
    const uploadsDir = path.join(process.cwd(), 'uploads');
    return uploadsDir;
};

// Ensure uploads directory exists
const uploadsDir = getUploadsDir();
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log('Created uploads directory:', uploadsDir);
}

// Configure multer storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const filename = `${uuidv4()}${ext}`;
        cb(null, filename);
    }
});

// Filter for images only
const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Only image files are allowed'));
    }
};

const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    }
});

// Error handling middleware for multer
const handleMulterError = (err: any, req: Request, res: Response, next: any) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ detail: 'File too large. Maximum size is 5MB.' });
        }
        return res.status(400).json({ detail: err.message });
    } else if (err) {
        return res.status(400).json({ detail: err.message });
    }
    next();
};

router.post('/image', upload.single('image'), handleMulterError, (req: Request, res: Response) => {
    try {
        if (!req.file) {
            return res.status(400).json({ detail: 'No file uploaded' });
        }

        const imageUrl = `http://localhost:8000/uploads/${req.file.filename}`;

        res.json({
            url: imageUrl,
            filename: req.file.filename
        });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ detail: 'Upload failed' });
    }
});

export default router;
