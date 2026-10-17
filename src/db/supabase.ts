import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { User, Ticket, TicketComment, TicketHistoryEntry, AuditLog } from '../types.ts';
import { SEED_USERS, SEED_TICKETS, SEED_AUDIT_LOGS } from '../services/seedData.ts';

dotenv.config();

const rawUrl = process.env.SUPABASE_URL?.trim();
const rawKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

export const isSupabaseConfigured = Boolean(rawUrl && rawKey);

const SUPABASE_URL = rawUrl || 'https://placeholder-project.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = rawKey || 'placeholder-key';

if (!isSupabaseConfigured) {
  console.warn(
    'Warning: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not defined in environment variables. Please configure your .env file.'
  );
}

export const DEFAULT_DEMO_PASSWORD = 'DeskFlow2026!';

// Initialize Supabase Admin Client
export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

export async function seedSupabaseIfEmpty() {
  if (!isSupabaseConfigured) {
    console.warn('Skipping Supabase seed: credentials not configured in environment.');
    return;
  }
  try {
    const { count, error } = await supabase
      .from('tickets')
      .select('*', { count: 'exact', head: true });

    if (error) {
      console.error('Error checking tickets count in Supabase:', error);
      return;
    }

    if (count !== null && count > 0) {
      console.log(`Supabase database already initialized with ${count} tickets.`);
      return;
    }

    console.log('Supabase tickets table is empty. Seeding initial enterprise tickets, comments, and history...');
    await resetSupabaseToSeed();
  } catch (err) {
    console.error('Failed to seed Supabase database:', err);
  }
}

export async function resetSupabaseToSeed() {
  const defaultHash = bcrypt.hashSync(DEFAULT_DEMO_PASSWORD, 10);

  // 1. Clean existing records (respecting FK order)
  await supabase.from('comments').delete().neq('id', 'placeholder');
  await supabase.from('ticket_history').delete().neq('id', 'placeholder');
  await supabase.from('tickets').delete().neq('id', 'placeholder');
  await supabase.from('sessions').delete().neq('id', 'placeholder');
  await supabase.from('audit_logs').delete().neq('id', 'placeholder');

  // 2. Upsert Users
  const userRows = SEED_USERS.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email.toLowerCase(),
    password_hash: defaultHash,
    role: u.role,
    department: u.department,
    job_title: u.jobTitle,
    phone: u.phone || null,
    avatar: u.avatar || null,
    is_active: u.isActive,
    created_at: u.createdAt,
  }));

  const { error: userErr } = await supabase.from('users').upsert(userRows, { onConflict: 'id' });
  if (userErr) {
    console.error('Error seeding users to Supabase:', userErr);
  }

  // 3. Insert Tickets
  const ticketRows = SEED_TICKETS.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    category: t.category,
    priority: t.priority,
    status: t.status,
    creator_id: t.creatorId,
    assignee_id: t.assigneeId || null,
    asset_tag: t.assetTag || null,
    location: t.location || null,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
    due_date: t.dueDate,
    resolved_at: t.resolvedAt || null,
    closed_at: t.closedAt || null,
    resolution_notes: t.resolutionNotes || null,
    root_cause_category: t.rootCauseCategory || null,
    reopen_reason: t.reopenReason || null,
  }));

  const { error: ticketErr } = await supabase.from('tickets').insert(ticketRows);
  if (ticketErr) {
    console.error('Error seeding tickets to Supabase:', ticketErr);
  }

  // 4. Insert Comments
  const allComments: any[] = [];
  for (const t of SEED_TICKETS) {
    for (const c of t.comments) {
      allComments.push({
        id: c.id,
        ticket_id: t.id,
        author_id: c.authorId,
        content: c.content,
        is_internal: Boolean(c.isInternal),
        created_at: c.createdAt,
      });
    }
  }

  if (allComments.length > 0) {
    const { error: commErr } = await supabase.from('comments').insert(allComments);
    if (commErr) {
      console.error('Error seeding comments to Supabase:', commErr);
    }
  }

  // 5. Insert History
  const allHistory: any[] = [];
  for (const t of SEED_TICKETS) {
    for (const h of t.history) {
      allHistory.push({
        id: h.id,
        ticket_id: t.id,
        actor_id: h.actorId,
        action: h.action,
        details: h.details,
        timestamp: h.timestamp,
      });
    }
  }

  if (allHistory.length > 0) {
    const { error: histErr } = await supabase.from('ticket_history').insert(allHistory);
    if (histErr) {
      console.error('Error seeding history to Supabase:', histErr);
    }
  }

  // 6. Insert Audit Logs
  const auditRows = SEED_AUDIT_LOGS.map((a) => ({
    id: a.id,
    timestamp: a.timestamp,
    user_id: a.userId,
    user_name: a.userName,
    user_role: a.userRole,
    action: a.action,
    target_type: a.targetType,
    target_id: a.targetId,
    details: a.details,
  }));

  const { error: auditErr } = await supabase.from('audit_logs').insert(auditRows);
  if (auditErr) {
    console.error('Error seeding audit logs to Supabase:', auditErr);
  }

  console.log('Supabase database successfully initialized with enterprise seed data.');
}

// Session Helpers with Supabase PostgreSQL
export async function createSession(userId: string, userAgent = ''): Promise<{ token: string; expiresAt: string }> {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date();
  expires.setHours(expires.getHours() + 24); // 24-hour expiration
  const expiresAt = expires.toISOString();
  const sessionId = `sess-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;

  const { error } = await supabase.from('sessions').insert({
    id: sessionId,
    user_id: userId,
    token,
    created_at: new Date().toISOString(),
    expires_at: expiresAt,
    user_agent: userAgent,
  });

  if (error) {
    console.error('Error creating session in Supabase:', error);
    throw new Error('Could not establish user session');
  }

  return { token, expiresAt };
}

export async function validateSession(token: string): Promise<User | null> {
  if (!token) return null;

  const nowIso = new Date().toISOString();

  // Clean expired sessions
  await supabase.from('sessions').delete().lt('expires_at', nowIso);

  const { data: sessionData, error } = await supabase
    .from('sessions')
    .select('user_id, expires_at, users:user_id (*)')
    .eq('token', token)
    .gt('expires_at', nowIso)
    .maybeSingle();

  if (error || !sessionData || !sessionData.users) {
    return null;
  }

  const u = sessionData.users as any;
  if (!u.is_active) {
    return null;
  }

  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    department: u.department,
    jobTitle: u.job_title,
    phone: u.phone || undefined,
    avatar: u.avatar || undefined,
    isActive: Boolean(u.is_active),
    createdAt: u.created_at,
  };
}

export async function deleteSession(token: string): Promise<void> {
  await supabase.from('sessions').delete().eq('token', token);
}
