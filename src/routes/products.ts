import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import * as cheerio from 'cheerio';

const router: Router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'wishvault-secret-key';

// Middleware to verify token
const authenticate = (req: Request, res: Response, next: Function) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ detail: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
        (req as any).userId = decoded.userId;
        next();
    } catch (error) {
        return res.status(401).json({ detail: 'Invalid token' });
    }
};

// Scrape product info from URL
router.post('/scrape', async (req: Request, res: Response) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ detail: 'URL is required' });
    }

    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
            timeout: 10000,
        });

        const $ = cheerio.load(response.data);

        // Extract title
        let name = '';
        const ogTitle = $('meta[property="og:title"]').attr('content');
        const titleTag = $('title').text();
        name = ogTitle || titleTag || 'Unknown Product';
        name = name.split('|')[0].split('-')[0].trim().substring(0, 255);

        // Extract price
        let price = 0;
        const pricePatterns = [
            $('meta[property="product:price:amount"]').attr('content'),
            $('[class*="price"]').first().text(),
            $('[class*="Price"]').first().text(),
        ];

        for (const pattern of pricePatterns) {
            if (pattern) {
                const numbers = pattern.match(/[\d,]+\.?\d*/);
                if (numbers) {
                    price = parseFloat(numbers[0].replace(/,/g, ''));
                    if (price > 0) break;
                }
            }
        }

        // Extract image
        let imageUrl = '';
        const ogImage = $('meta[property="og:image"]').attr('content');
        const twitterImage = $('meta[name="twitter:image"]').attr('content');
        imageUrl = ogImage || twitterImage || '';

        // Extract description
        let description = '';
        const ogDesc = $('meta[property="og:description"]').attr('content');
        const metaDesc = $('meta[name="description"]').attr('content');
        description = ogDesc || metaDesc || '';
        description = description.substring(0, 500);

        res.json({
            name,
            price,
            image_url: imageUrl,
            description: description || null,
        });
    } catch (error: any) {
        console.error('Scraping error:', error.message);
        res.status(400).json({ detail: 'Could not fetch product info' });
    }
});

// Update product
router.put('/:id', authenticate, async (req: Request, res: Response) => {
    const prisma: PrismaClient = req.app.get('prisma');
    const userId = (req as any).userId;
    const { id } = req.params;
    const { name, description, price, image_url, product_url, is_crowdfund, is_active } = req.body;

    try {
        const product = await prisma.product.findUnique({
            where: { id },
            include: { wishlist: true },
        });

        if (!product || product.wishlist.userId !== userId) {
            return res.status(404).json({ detail: 'Product not found or not authorized' });
        }

        const updated = await prisma.product.update({
            where: { id },
            data: {
                name,
                description,
                price,
                imageUrl: image_url,
                productUrl: product_url,
                isCrowdfund: is_crowdfund,
                isActive: is_active,
            },
        });

        res.json({
            id: updated.id,
            wishlist_id: updated.wishlistId,
            name: updated.name,
            description: updated.description,
            price: updated.price,
            image_url: updated.imageUrl,
            product_url: updated.productUrl,
            is_reserved: updated.isReserved,
            reserved_by: null, // Hide to keep surprise
            is_crowdfund: updated.isCrowdfund,
            is_active: updated.isActive,
            created_at: updated.createdAt.toISOString(),
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ detail: 'Failed to update product' });
    }
});

// Delete product
router.delete('/:id', authenticate, async (req: Request, res: Response) => {
    const prisma: PrismaClient = req.app.get('prisma');
    const userId = (req as any).userId;
    const { id } = req.params;

    try {
        const product = await prisma.product.findUnique({
            where: { id },
            include: { wishlist: true },
        });

        if (!product || product.wishlist.userId !== userId) {
            return res.status(404).json({ detail: 'Product not found or not authorized' });
        }

        // Check for contributions
        const contributions = await prisma.contribution.count({
            where: { productId: id },
        });

        if (contributions > 0) {
            // Mark as inactive instead of deleting
            await prisma.product.update({
                where: { id },
                data: { isActive: false },
            });
            return res.json({ message: 'Product marked as inactive (has contributions)' });
        }

        await prisma.product.delete({ where: { id } });
        res.json({ message: 'Product deleted' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ detail: 'Failed to delete product' });
    }
});

// Reserve product
router.post('/:id/reserve', async (req: Request, res: Response) => {
    const prisma: PrismaClient = req.app.get('prisma');
    const io: any = req.app.get('io');
    const { id } = req.params;

    try {
        const product = await prisma.product.findUnique({
            where: { id },
            include: { wishlist: true }
        });

        if (!product) {
            return res.status(404).json({ detail: 'Product not found' });
        }

        if (product.isReserved) {
            return res.status(400).json({ detail: 'Product already reserved' });
        }

        const reservationToken = uuidv4();

        const updated = await prisma.product.update({
            where: { id },
            data: {
                isReserved: true,
                reservedBy: reservationToken,
            },
        });

        // Emit real-time update to all clients viewing this list
        io.to(`list_${product.wishlistId}`).emit('product_reserved', {
            productId: id,
            wishlistId: product.wishlistId,
            isReserved: true,
        });

        res.json({
            message: 'Product reserved',
            reservation_token: reservationToken,
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ detail: 'Failed to reserve product' });
    }
});

// Cancel reservation
router.delete('/:id/reserve', async (req: Request, res: Response) => {
    const prisma: PrismaClient = req.app.get('prisma');
    const { id } = req.params;
    const { reservation_token } = req.query;

    try {
        const product = await prisma.product.findUnique({ where: { id } });

        if (!product) {
            return res.status(404).json({ detail: 'Product not found' });
        }

        if (product.reservedBy !== reservation_token) {
            return res.status(403).json({ detail: 'Invalid reservation token' });
        }

        await prisma.product.update({
            where: { id },
            data: {
                isReserved: false,
                reservedBy: null,
            },
        });

        res.json({ message: 'Reservation cancelled' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ detail: 'Failed to cancel reservation' });
    }
});

// Add contribution
router.post('/:id/contribute', async (req: Request, res: Response) => {
    const prisma: PrismaClient = req.app.get('prisma');
    const io: any = req.app.get('io');
    const { id } = req.params;
    const { amount, contributor_name, message } = req.body;

    if (!amount || amount < 1) {
        return res.status(400).json({ detail: 'Minimum contribution is $1' });
    }

    try {
        const product = await prisma.product.findUnique({
            where: { id },
            include: { wishlist: true }
        });

        if (!product) {
            return res.status(404).json({ detail: 'Product not found' });
        }

        if (product.isReserved) {
            return res.status(400).json({ detail: 'Product already reserved' });
        }

        const contribution = await prisma.contribution.create({
            data: {
                productId: id,
                contributorName: contributor_name || 'Anonymous',
                amount,
                message,
            },
        });

        // Get total contributions for this product
        const allContributions = await prisma.contribution.findMany({
            where: { productId: id },
        });
        const totalContributions = allContributions.reduce((sum, c) => sum + c.amount, 0);

        // Emit real-time update to all clients viewing this list
        io.to(`list_${product.wishlistId}`).emit('contribution_added', {
            productId: id,
            wishlistId: product.wishlistId,
            totalContributions,
            contributionsCount: allContributions.length,
        });

        res.json({
            id: contribution.id,
            product_id: contribution.productId,
            contributor_name: contribution.contributorName,
            amount: contribution.amount,
            message: contribution.message,
            created_at: contribution.createdAt.toISOString(),
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ detail: 'Failed to add contribution' });
    }
});


export default router;
