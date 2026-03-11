import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const router: Router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'wishvault-secret-key';

router.post('/register', async (req: Request, res: Response) => {
    const prisma: PrismaClient = req.app.get('prisma');
    const { email, name, password } = req.body;

    try {
        // Check if user exists
        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) {
            return res.status(400).json({ detail: 'Email already registered' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user
        const user = await prisma.user.create({
            data: { email, name, password: hashedPassword },
        });

        // Generate token
        const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });

        res.json({
            id: user.id,
            email: user.email,
            name: user.name,
            access_token: token,
            token_type: 'bearer',
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ detail: 'Registration failed' });
    }
});

router.post('/login', async (req: Request, res: Response) => {
    const prisma: PrismaClient = req.app.get('prisma');
    const { email, password } = req.body;

    try {
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
            return res.status(401).json({ detail: 'Invalid email or password' });
        }

        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
            return res.status(401).json({ detail: 'Invalid email or password' });
        }

        const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });

        res.json({
            access_token: token,
            token_type: 'bearer',
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ detail: 'Login failed' });
    }
});

router.get('/me', async (req: Request, res: Response) => {
    const prisma: PrismaClient = req.app.get('prisma');
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ detail: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
        const user = await prisma.user.findUnique({
            where: { id: decoded.userId },
            select: { id: true, email: true, name: true, createdAt: true },
        });

        if (!user) {
            return res.status(401).json({ detail: 'User not found' });
        }

        res.json(user);
    } catch (error) {
        res.status(401).json({ detail: 'Invalid token' });
    }
});

export default router;
