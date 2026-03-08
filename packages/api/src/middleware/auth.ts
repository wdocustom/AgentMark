import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { query } from '../db/pool.js';
import type { User, UserRole } from '@agentmark/shared';

const JWT_SECRET = process.env.JWT_SECRET || 'agentmark-dev-secret-change-in-production';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '24h';

export interface AuthPayload {
  userId: string;
  organizationId: string;
  role: UserRole;
}

export interface AuthRequest extends Request {
  auth?: AuthPayload;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

export function verifyToken(token: string): AuthPayload {
  return jwt.verify(token, JWT_SECRET) as AuthPayload;
}

export function authenticate(req: AuthRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Missing authentication token' } });
    return;
  }

  try {
    const token = header.substring(7);
    req.auth = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } });
  }
}

export function authorize(...roles: UserRole[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } });
      return;
    }
    if (roles.length > 0 && !roles.includes(req.auth.role)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
      return;
    }
    next();
  };
}

export async function getUserById(id: string): Promise<User | null> {
  const { rows } = await query(
    'SELECT id, email, name, role, organization_id, avatar_url, created_at, updated_at FROM users WHERE id = $1',
    [id]
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    organizationId: row.organization_id,
    avatarUrl: row.avatar_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
