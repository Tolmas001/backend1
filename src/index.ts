import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import * as cheerio from 'cheerio';
import http from 'http';
import authRoutes from './routes/auth';
import listRoutes from './routes/lists';
import productRoutes from './routes/products';
import uploadRoutes from './routes/upload';
import publicRoutes from './routes/public';

dotenv.config();

const app: Application = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 8000;

// Check if running in serverless environment
const isServerless = process.env.VERCEL === '1' || process.env.AWS_LAMBDA_FUNCTION_NAME;

// Create HTTP server and Socket.io instance
const server = http.createServer(app);

let io: any = null;

if (!isServerless) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Server } = require('socket.io');
    io = new Server(server, {
        cors: {
            origin: process.env.CORS_ORIGIN || "http://localhost:3000",
            methods: ["GET", "POST", "PUT", "DELETE"],
        }
    });
}

// Make io available globally (null for serverless)
app.set('io', io);

// Socket.io connection handling - only for non-serverless
if (io) {
    io.on('connection', (socket: any) => {
        console.log('Client connected:', socket.id);

        // Join a room for a specific list
        socket.on('join_list', (listId: string) => {
            socket.join(`list_${listId}`);
            console.log(`Socket ${socket.id} joined list_${listId}`);
        });

        socket.on('leave_list', (listId: string) => {
            socket.leave(listId);
        });

        socket.on('disconnect', () => {
            console.log('Client disconnected:', socket.id);
        });
    });
}

// Middleware
app.use(express.json());

// CORS configuration - support multiple origins for Vercel
const corsOrigin = process.env.CORS_ORIGIN || "http://localhost:3000";
const allowedOrigins = corsOrigin.split(',').map(o => o.trim());

app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (mobile apps, curl requests)
        if (!origin) return callback(null, true);

        // Check if origin is in allowed list
        if (allowedOrigins.includes(origin) ||
            allowedOrigins.includes('*') ||
            origin.endsWith('.vercel.app') ||
            origin.endsWith('.localhost:3000')) {
            return callback(null, true);
        }

        callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Accept"],
}));

// Handle preflight requests
app.options("*", cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin) ||
            allowedOrigins.includes('*') ||
            origin.endsWith('.vercel.app') ||
            origin.endsWith('.localhost:3000')) {
            return callback(null, true);
        }
        callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Accept"],
}));

// Make prisma available globally
app.set('prisma', prisma);

// Serve uploaded files
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/lists', listRoutes);
app.use('/api/products', productRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/scrape', productRoutes);

// Scrape endpoint at /api/scrape
app.post('/api/scrape', async (req: Request, res: Response) => {
    const { url } = req.body;
    if (!url) {
        return res.status(400).json({ detail: 'URL is required' });
    }
    try {
        const response = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            timeout: 10000,
        });
        const $ = cheerio.load(response.data);
        let name = $('meta[property="og:title"]').attr('content') || $('title').text() || 'Unknown Product';
        name = name.split('|')[0].split('-')[0].trim().substring(0, 255);
        let price = 0;
        const priceStr = $('meta[property="product:price:amount"]').attr('content') || $('[class*="price"]').first().text();
        if (priceStr) {
            const numMatch = priceStr.replace(/[^0-9.]/g, '');
            price = parseFloat(numMatch) || 0;
        }
        const imageUrl = $('meta[property="og:image"]').attr('content') || $('meta[name="twitter:image"]').attr('content') || '';
        res.json({ name, price, imageUrl, url });
    } catch (error: any) {
        console.error('Scrape error:', error.message);
        res.status(500).json({ detail: 'Failed to scrape URL' });
    }
});
app.use('/api/upload', uploadRoutes);

// Health check
app.get('/health', (req: Request, res: Response) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Error handling
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    console.error(err.stack);
    res.status(500).json({ detail: 'Something went wrong!' });
});

// Start server with Socket.io
server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`🔌 Socket.io ready for real-time updates`);
});

export { app, prisma, io };
