import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const router: Router = Router();

// Get public list by token (no auth required)
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

export default router;
