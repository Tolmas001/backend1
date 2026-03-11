import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

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

// Get all lists for current user
router.get('/', authenticate, async (req: Request, res: Response) => {
    const prisma: PrismaClient = req.app.get('prisma');
    const userId = (req as any).userId;

    try {
        const lists = await prisma.wishList.findMany({
            where: { userId },
            include: { products: { where: { isActive: true } } },
            orderBy: { createdAt: 'desc' },
        });

        res.json(lists.map(list => ({
            id: list.id,
            user_id: list.userId,
            title: list.title,
            description: list.description,
            occasion: list.occasion,
            cover_image: list.coverImage,
            is_public: list.isPublic,
            share_token: list.shareToken,
            created_at: list.createdAt.toISOString(),
            updated_at: list.updatedAt.toISOString(),
            products: list.products.map(p => ({
                id: p.id,
                wishlist_id: p.wishlistId,
                name: p.name,
                description: p.description,
                price: p.price,
                image_url: p.imageUrl,
                product_url: p.productUrl,
                is_reserved: p.isReserved,
                reserved_by: null, // Hide from owner to keep surprise
                is_crowdfund: p.isCrowdfund,
                is_active: p.isActive,
                created_at: p.createdAt.toISOString(),
            })),
        })));
    } catch (error) {
        console.error(error);
        res.status(500).json({ detail: 'Failed to fetch lists' });
    }
});

// Create new list
router.post('/', authenticate, async (req: Request, res: Response) => {
    const prisma: PrismaClient = req.app.get('prisma');
    const userId = (req as any).userId;
    const { title, description, occasion, cover_image } = req.body;

    try {
        const list = await prisma.wishList.create({
            data: {
                userId,
                title,
                description,
                occasion,
                coverImage: cover_image,
                shareToken: uuidv4(),
            },
        });

        res.json({
            id: list.id,
            user_id: list.userId,
            title: list.title,
            description: list.description,
            occasion: list.occasion,
            cover_image: list.coverImage,
            is_public: list.isPublic,
            share_token: list.shareToken,
            created_at: list.createdAt.toISOString(),
            updated_at: list.updatedAt.toISOString(),
            products: [],
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ detail: 'Failed to create list' });
    }
});

// Get single list (owner only)
router.get('/:id', authenticate, async (req: Request, res: Response) => {
    const prisma: PrismaClient = req.app.get('prisma');
    const userId = (req as any).userId;
    const { id } = req.params;

    try {
        const list = await prisma.wishList.findUnique({
            where: { id },
            include: {
                products: {
                    where: { isActive: true },
                    include: {
                        contributions: true,
                    },
                },
            },
        });

        if (!list) {
            return res.status(404).json({ detail: 'List not found' });
        }

        if (list.userId !== userId) {
            return res.status(403).json({ detail: 'Not authorized' });
        }

        res.json({
            id: list.id,
            user_id: list.userId,
            title: list.title,
            description: list.description,
            occasion: list.occasion,
            cover_image: list.coverImage,
            is_public: list.isPublic,
            share_token: list.shareToken,
            created_at: list.createdAt.toISOString(),
            updated_at: list.updatedAt.toISOString(),
            products: list.products.map(p => {
                const totalContributions = p.contributions.reduce((sum, c) => sum + c.amount, 0);
                return {
                    id: p.id,
                    wishlist_id: p.wishlistId,
                    name: p.name,
                    description: p.description,
                    price: p.price,
                    image_url: p.imageUrl,
                    product_url: p.productUrl,
                    is_reserved: p.isReserved,
                    reserved_by: null, // Hide from owner
                    is_crowdfund: p.isCrowdfund,
                    is_active: p.isActive,
                    created_at: p.createdAt.toISOString(),
                    total_contributions: totalContributions,
                    contributions_count: p.contributions.length,
                };
            }),
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ detail: 'Failed to fetch list' });
    }
});

// Update list
router.put('/:id', authenticate, async (req: Request, res: Response) => {
    const prisma: PrismaClient = req.app.get('prisma');
    const userId = (req as any).userId;
    const { id } = req.params;
    const { title, description, occasion, cover_image, is_public } = req.body;

    try {
        const list = await prisma.wishList.findUnique({ where: { id } });

        if (!list || list.userId !== userId) {
            return res.status(404).json({ detail: 'List not found or not authorized' });
        }

        const updated = await prisma.wishList.update({
            where: { id },
            data: {
                title,
                description,
                occasion,
                coverImage: cover_image,
                isPublic: is_public,
            },
        });

        res.json({
            id: updated.id,
            user_id: updated.userId,
            title: updated.title,
            description: updated.description,
            occasion: updated.occasion,
            cover_image: updated.coverImage,
            is_public: updated.isPublic,
            share_token: updated.shareToken,
            created_at: updated.createdAt.toISOString(),
            updated_at: updated.updatedAt.toISOString(),
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ detail: 'Failed to update list' });
    }
});

// Delete list
router.delete('/:id', authenticate, async (req: Request, res: Response) => {
    const prisma: PrismaClient = req.app.get('prisma');
    const userId = (req as any).userId;
    const { id } = req.params;

    try {
        const list = await prisma.wishList.findUnique({ where: { id } });

        if (!list || list.userId !== userId) {
            return res.status(404).json({ detail: 'List not found or not authorized' });
        }

        await prisma.wishList.delete({ where: { id } });

        res.json({ message: 'List deleted' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ detail: 'Failed to delete list' });
    }
});

// Get public list by token
router.get('/:token', async (req: Request, res: Response) => {
    const prisma: PrismaClient = req.app.get('prisma');
    const { token } = req.params;

    try {
        const list = await prisma.wishList.findUnique({
            where: { shareToken: token },
            include: {
                products: {
                    where: { isActive: true },
                    include: {
                        contributions: true,
                    },
                },
            },
        });

        if (!list) {
            return res.status(404).json({ detail: 'List not found' });
        }

        res.json({
            id: list.id,
            user_id: list.userId,
            title: list.title,
            description: list.description,
            occasion: list.occasion,
            cover_image: list.coverImage,
            is_public: list.isPublic,
            share_token: list.shareToken,
            created_at: list.createdAt.toISOString(),
            updated_at: list.updatedAt.toISOString(),
            products: list.products.map(p => {
                const totalContributions = p.contributions.reduce((sum, c) => sum + c.amount, 0);
                return {
                    id: p.id,
                    wishlist_id: p.wishlistId,
                    name: p.name,
                    description: p.description,
                    price: p.price,
                    image_url: p.imageUrl,
                    product_url: p.productUrl,
                    is_reserved: p.isReserved,
                    reserved_by: null, // Always hide
                    is_crowdfund: p.isCrowdfund,
                    is_active: p.isActive,
                    created_at: p.createdAt.toISOString(),
                    total_contributions: totalContributions,
                    contributions_count: p.contributions.length,
                };
            }),
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ detail: 'Failed to fetch list' });
    }
});

// Add product to list
router.post('/:id/products', authenticate, async (req: Request, res: Response) => {
    const prisma: PrismaClient = req.app.get('prisma');
    const userId = (req as any).userId;
    const { id } = req.params;
    const { name, description, price, image_url, product_url, is_crowdfund } = req.body;

    try {
        const list = await prisma.wishList.findUnique({ where: { id } });

        if (!list || list.userId !== userId) {
            return res.status(403).json({ detail: 'Not authorized' });
        }

        const product = await prisma.product.create({
            data: {
                wishlistId: id,
                name,
                description,
                price,
                imageUrl: image_url,
                productUrl: product_url,
                isCrowdfund: is_crowdfund || price > 50,
            },
        });

        res.json({
            id: product.id,
            wishlist_id: product.wishlistId,
            name: product.name,
            description: product.description,
            price: product.price,
            image_url: product.imageUrl,
            product_url: product.productUrl,
            is_reserved: product.isReserved,
            reserved_by: product.reservedBy,
            is_crowdfund: product.isCrowdfund,
            is_active: product.isActive,
            created_at: product.createdAt.toISOString(),
            total_contributions: 0,
            contributions_count: 0,
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ detail: 'Failed to add product' });
    }
});

export default router;
