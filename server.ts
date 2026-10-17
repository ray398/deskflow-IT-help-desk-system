import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import {
  supabase,
  seedSupabaseIfEmpty,
  resetSupabaseToSeed,
  createSession,
  validateSession,
  deleteSession,
  DEFAULT_DEMO_PASSWORD,
} from './src/db/supabase.ts';
import {
  User,
  Ticket,
  AuditLog,
  TicketComment,
  TicketHistoryEntry,
  TicketPriority,
  TicketStatus,
  TicketCategory,
} from './src/types.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;

// Initialize Supabase database seed if needed
seedSupabaseIfEmpty().catch((err) => {
  console.error('Error during initial Supabase seed check:', err);
});

function calculateDueDate(priority: TicketPriority, fromDate = new Date()): string {
  const date = new Date(fromDate);
  switch (priority) {
    case 'critical':
      date.setHours(date.getHours() + 4);
      break;
    case 'high':
      date.setHours(date.getHours() + 8);
      break;
    case 'medium':
      date.setHours(date.getHours() + 24);
      break;
    case 'low':
      date.setHours(date.getHours() + 72);
      break;
  }
  return date.toISOString();
}

async function loadTicketComments(ticketId: string, isEmployee: boolean): Promise<TicketComment[]> {
  let query = supabase
    .from('comments')
    .select('id, ticket_id, author_id, content, is_internal, created_at, users:author_id (name, role)')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true });

  if (isEmployee) {
    query = query.eq('is_internal', false);
  }

  const { data, error } = await query;
  if (error || !data) return [];

  return data.map((r: any) => ({
    id: r.id,
    ticketId: r.ticket_id,
    authorId: r.author_id,
    authorName: r.users?.name || 'Unknown',
    authorRole: r.users?.role || 'employee',
    content: r.content,
    createdAt: r.created_at,
    isInternal: Boolean(r.is_internal),
  }));
}

async function loadTicketHistory(ticketId: string): Promise<TicketHistoryEntry[]> {
  const { data, error } = await supabase
    .from('ticket_history')
    .select('id, ticket_id, actor_id, action, details, timestamp, users:actor_id (name, role)')
    .eq('ticket_id', ticketId)
    .order('timestamp', { ascending: false });

  if (error || !data) return [];

  return data.map((r: any) => ({
    id: r.id,
    ticketId: r.ticket_id,
    actorId: r.actor_id,
    actorName: r.users?.name || 'Unknown',
    actorRole: r.users?.role || 'employee',
    action: r.action,
    details: r.details,
    timestamp: r.timestamp,
  }));
}

async function rowToTicket(r: any, isEmployee = false): Promise<Ticket> {
  const [comments, history] = await Promise.all([
    loadTicketComments(r.id, isEmployee),
    loadTicketHistory(r.id),
  ]);

  return {
    id: r.id,
    title: r.title,
    description: r.description,
    category: r.category as TicketCategory,
    priority: r.priority as TicketPriority,
    status: r.status as TicketStatus,
    creatorId: r.creator_id,
    creatorName: r.creator?.name || 'Unknown',
    creatorEmail: r.creator?.email || '',
    creatorDepartment: r.creator?.department || '',
    assigneeId: r.assignee_id || null,
    assigneeName: r.assignee?.name || null,
    assigneeRole: r.assignee?.role || null,
    assetTag: r.asset_tag || undefined,
    location: r.location || undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    dueDate: r.due_date,
    resolvedAt: r.resolved_at || undefined,
    closedAt: r.closed_at || undefined,
    resolutionNotes: r.resolution_notes || undefined,
    rootCauseCategory: r.root_cause_category || undefined,
    reopenReason: r.reopen_reason || undefined,
    comments,
    history,
  };
}

async function startServer() {
  const app = express();

  app.use(express.json());

  // Secure Authentication Middleware - Validates Session Token against Supabase PostgreSQL
  app.use(async (req, res, next) => {
    const authHeader = req.headers.authorization;
    let token: string | null = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    }

    if (token) {
      try {
        const user = await validateSession(token);
        if (user) {
          (req as any).user = user;
          (req as any).sessionToken = token;
        }
      } catch (err) {
        console.error('Session validation error:', err);
      }
    }
    next();
  });

  const requireAuth = (req: any, res: any, next: any) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required. Please log in with valid credentials.' });
    }
    next();
  };

  // ==========================================
  // AUTHENTICATION & SESSION ENDPOINTS
  // ==========================================

  // Login with Email & Password (Bcrypt verified on Supabase PostgreSQL)
  app.post('/api/auth/login', async (req: any, res: any) => {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const { data: userRow, error } = await supabase
      .from('users')
      .select('*')
      .ilike('email', email.trim().toLowerCase())
      .maybeSingle();

    if (error || !userRow) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    if (!userRow.is_active) {
      return res.status(403).json({ error: 'User account is deactivated. Contact Administrator.' });
    }

    const isMatch = bcrypt.compareSync(password, userRow.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const user: User = {
      id: userRow.id,
      name: userRow.name,
      email: userRow.email,
      role: userRow.role,
      department: userRow.department,
      jobTitle: userRow.job_title,
      phone: userRow.phone || undefined,
      avatar: userRow.avatar || undefined,
      isActive: Boolean(userRow.is_active),
      createdAt: userRow.created_at,
    };

    const session = await createSession(user.id, req.headers['user-agent'] || '');

    // Log to Supabase audit_logs
    await supabase.from('audit_logs').insert({
      id: `log-${Date.now()}`,
      timestamp: new Date().toISOString(),
      user_id: user.id,
      user_name: user.name,
      user_role: user.role,
      action: 'User Login',
      target_type: 'user',
      target_id: user.id,
      details: `User ${user.name} authenticated successfully against Supabase PostgreSQL.`,
    });

    res.json({
      user,
      token: session.token,
      expiresAt: session.expiresAt,
    });
  });

  // User Registration (Self-Service Employee Onboarding into Supabase)
  app.post('/api/auth/register', async (req: any, res: any) => {
    const { name, email, password, department, jobTitle, phone } = req.body;

    if (!name || !email || !password || !department || !jobTitle) {
      return res.status(400).json({ error: 'Please provide all required registration fields.' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Check existing
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .ilike('email', normalizedEmail)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ error: 'An account with this email address already exists.' });
    }

    const newUserId = `usr-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    const passwordHash = bcrypt.hashSync(password, 10);
    const now = new Date().toISOString();

    const { error: insertErr } = await supabase.from('users').insert({
      id: newUserId,
      name: name.trim(),
      email: normalizedEmail,
      password_hash: passwordHash,
      role: 'employee',
      department: department.trim(),
      job_title: jobTitle.trim(),
      phone: phone?.trim() || null,
      is_active: true,
      created_at: now,
    });

    if (insertErr) {
      console.error('Error inserting user to Supabase:', insertErr);
      return res.status(500).json({ error: 'Failed to create user account in Supabase.' });
    }

    const newUser: User = {
      id: newUserId,
      name: name.trim(),
      email: normalizedEmail,
      role: 'employee',
      department: department.trim(),
      jobTitle: jobTitle.trim(),
      phone: phone?.trim() || undefined,
      isActive: true,
      createdAt: now,
    };

    const session = await createSession(newUser.id, req.headers['user-agent'] || '');

    await supabase.from('audit_logs').insert({
      id: `log-${Date.now()}`,
      timestamp: now,
      user_id: newUser.id,
      user_name: newUser.name,
      user_role: 'employee',
      action: 'User Registered',
      target_type: 'user',
      target_id: newUser.id,
      details: `New employee registered in Supabase: ${newUser.name} (${newUser.email})`,
    });

    res.status(201).json({
      user: newUser,
      token: session.token,
      expiresAt: session.expiresAt,
    });
  });

  // Logout (Revoke Active Session Token in Supabase)
  app.post('/api/auth/logout', requireAuth, async (req: any, res: any) => {
    if (req.sessionToken) {
      await deleteSession(req.sessionToken);
    }
    res.json({ message: 'Session successfully revoked. Logged out.' });
  });

  // Current User Profile
  app.get('/api/auth/me', requireAuth, (req: any, res: any) => {
    res.json({ user: req.user });
  });

  // ==========================================
  // USER MANAGEMENT ENDPOINTS
  // ==========================================

  app.get('/api/users', requireAuth, async (req: any, res: any) => {
    const caller = req.user as User;

    if (caller.role === 'employee') {
      const { data, error } = await supabase
        .from('users')
        .select('id, name, role, department, job_title, is_active')
        .eq('is_active', true)
        .order('name', { ascending: true });

      if (error) return res.status(500).json({ error: 'Failed to fetch users from database.' });

      const publicUsers = (data || []).map((r: any) => ({
        id: r.id,
        name: r.name,
        role: r.role,
        department: r.department,
        jobTitle: r.job_title,
        isActive: Boolean(r.is_active),
      }));
      return res.json({ users: publicUsers });
    }

    const { data, error } = await supabase
      .from('users')
      .select('id, name, email, role, department, job_title, phone, avatar, is_active, created_at')
      .order('name', { ascending: true });

    if (error) return res.status(500).json({ error: 'Failed to fetch users from database.' });

    const users: User[] = (data || []).map((r: any) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      role: r.role,
      department: r.department,
      jobTitle: r.job_title,
      phone: r.phone || undefined,
      avatar: r.avatar || undefined,
      isActive: Boolean(r.is_active),
      createdAt: r.created_at,
    }));

    res.json({ users });
  });

  // Admin user provisioning
  app.post('/api/users', requireAuth, async (req: any, res: any) => {
    const caller = req.user as User;
    if (caller.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied: Only Administrators can provision user accounts.' });
    }

    const { name, email, role, department, jobTitle, phone, password } = req.body;
    if (!name || !email || !role || !department || !jobTitle) {
      return res.status(400).json({ error: 'Missing required user profile fields.' });
    }

    const validRoles = ['employee', 'technician', 'manager', 'admin'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid user role specified.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .ilike('email', normalizedEmail)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ error: 'A user with this corporate email already exists.' });
    }

    const initialPassword = password?.trim() || DEFAULT_DEMO_PASSWORD;
    const passwordHash = bcrypt.hashSync(initialPassword, 10);
    const newUserId = `usr-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    const now = new Date().toISOString();

    const { error: insertErr } = await supabase.from('users').insert({
      id: newUserId,
      name: name.trim(),
      email: normalizedEmail,
      password_hash: passwordHash,
      role,
      department: department.trim(),
      job_title: jobTitle.trim(),
      phone: phone?.trim() || null,
      is_active: true,
      created_at: now,
    });

    if (insertErr) {
      return res.status(500).json({ error: 'Failed to provision user in Supabase.' });
    }

    const newUser: User = {
      id: newUserId,
      name: name.trim(),
      email: normalizedEmail,
      role,
      department: department.trim(),
      jobTitle: jobTitle.trim(),
      phone: phone?.trim() || undefined,
      isActive: true,
      createdAt: now,
    };

    await supabase.from('audit_logs').insert({
      id: `log-${Date.now()}`,
      timestamp: now,
      user_id: caller.id,
      user_name: caller.name,
      user_role: caller.role,
      action: 'User Provisioned',
      target_type: 'user',
      target_id: newUser.id,
      details: `Administrator provisioned user ${newUser.name} (${newUser.email}) with role ${newUser.role}`,
    });

    res.status(201).json({ user: newUser });
  });

  // Admin user update (Role change, deactivation, profile updates)
  app.patch('/api/users/:id', requireAuth, async (req: any, res: any) => {
    const caller = req.user as User;
    if (caller.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied: Only Administrators can modify user roles and statuses.' });
    }

    const { role, isActive, department, jobTitle, phone, password } = req.body;
    const updatePayload: any = {};

    if (role) {
      const validRoles = ['employee', 'technician', 'manager', 'admin'];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ error: 'Invalid user role.' });
      }
      updatePayload.role = role;
    }

    if (typeof isActive === 'boolean') {
      updatePayload.is_active = isActive;
      // If user is deactivated, immediately terminate all their active sessions
      if (!isActive) {
        await supabase.from('sessions').delete().eq('user_id', req.params.id);
      }
    }

    if (department) updatePayload.department = department.trim();
    if (jobTitle) updatePayload.job_title = jobTitle.trim();
    if (phone !== undefined) updatePayload.phone = phone ? phone.trim() : null;
    if (password && password.trim().length >= 8) {
      updatePayload.password_hash = bcrypt.hashSync(password.trim(), 10);
    }

    const { data: updatedRow, error } = await supabase
      .from('users')
      .update(updatePayload)
      .eq('id', req.params.id)
      .select()
      .maybeSingle();

    if (error || !updatedRow) {
      return res.status(404).json({ error: 'Failed to update user in Supabase.' });
    }

    const updatedUser: User = {
      id: updatedRow.id,
      name: updatedRow.name,
      email: updatedRow.email,
      role: updatedRow.role,
      department: updatedRow.department,
      jobTitle: updatedRow.job_title,
      phone: updatedRow.phone || undefined,
      avatar: updatedRow.avatar || undefined,
      isActive: Boolean(updatedRow.is_active),
      createdAt: updatedRow.created_at,
    };

    await supabase.from('audit_logs').insert({
      id: `log-${Date.now()}`,
      timestamp: new Date().toISOString(),
      user_id: caller.id,
      user_name: caller.name,
      user_role: caller.role,
      action: 'User Updated',
      target_type: 'user',
      target_id: updatedUser.id,
      details: `Administrator updated ${updatedUser.name}: role=${updatedUser.role}, active=${updatedUser.isActive}`,
    });

    res.json({ user: updatedUser });
  });

  // ==========================================
  // TICKETS ENDPOINTS (RBAC PROTECTED)
  // ==========================================

  // List Tickets with Multi-faceted Filtering & RBAC
  app.get('/api/tickets', requireAuth, async (req: any, res: any) => {
    const caller = req.user as User;
    const {
      search,
      status,
      category,
      priority,
      assigneeId,
      myTicketsOnly,
      slaStatus,
      sortBy = 'created_at',
      sortOrder = 'desc',
      page = 1,
      limit = 10,
    } = req.query;

    let query = supabase
      .from('tickets')
      .select('*, creator:creator_id (name, email, department), assignee:assignee_id (name, role)', { count: 'exact' });

    // RBAC: Employees strictly access only tickets they created
    if (caller.role === 'employee') {
      query = query.eq('creator_id', caller.id);
    } else if (caller.role === 'technician' && myTicketsOnly === 'true') {
      query = query.eq('assignee_id', caller.id);
    }

    // Filters
    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    if (category && category !== 'all') {
      query = query.eq('category', category);
    }

    if (priority && priority !== 'all') {
      query = query.eq('priority', priority);
    }

    if (assigneeId && assigneeId !== 'all') {
      if (assigneeId === 'unassigned') {
        query = query.is('assignee_id', null);
      } else {
        query = query.eq('assignee_id', assigneeId);
      }
    }

    // SLA filter
    const nowIso = new Date().toISOString();
    if (slaStatus === 'overdue') {
      query = query.in('status', ['open', 'in_progress']).lt('due_date', nowIso);
    } else if (slaStatus === 'due_soon') {
      const soon = new Date();
      soon.setHours(soon.getHours() + 4);
      query = query.in('status', ['open', 'in_progress']).gte('due_date', nowIso).lte('due_date', soon.toISOString());
    }

    // Search filter
    if (search && typeof search === 'string' && search.trim() !== '') {
      const q = search.trim();
      query = query.or(`id.ilike.%${q}%,title.ilike.%${q}%,description.ilike.%${q}%,asset_tag.ilike.%${q}%`);
    }

    // Sorting
    const isAscending = sortOrder === 'asc';
    const allowedSortFields: Record<string, string> = {
      created_at: 'created_at',
      createdAt: 'created_at',
      due_date: 'due_date',
      dueDate: 'due_date',
      updated_at: 'updated_at',
      updatedAt: 'updated_at',
      id: 'id',
      priority: 'priority',
    };
    const sortField = allowedSortFields[sortBy as string] || 'created_at';
    query = query.order(sortField, { ascending: isAscending });

    // Pagination
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit as string, 10) || 10);
    const fromIndex = (pageNum - 1) * limitNum;
    const toIndex = fromIndex + limitNum - 1;

    query = query.range(fromIndex, toIndex);

    const { data: rows, count, error } = await query;
    if (error) {
      console.error('Error fetching tickets from Supabase:', error);
      return res.status(500).json({ error: 'Failed to retrieve tickets.' });
    }

    const total = count || 0;
    const isEmployee = caller.role === 'employee';
    const tickets = await Promise.all((rows || []).map((r) => rowToTicket(r, isEmployee)));

    res.json({
      tickets,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  });

  // Get Single Ticket Detail (With Employee Authorization Check)
  app.get('/api/tickets/:id', requireAuth, async (req: any, res: any) => {
    const caller = req.user as User;

    const { data: row, error } = await supabase
      .from('tickets')
      .select('*, creator:creator_id (name, email, department), assignee:assignee_id (name, role)')
      .eq('id', req.params.id)
      .maybeSingle();

    if (error || !row) {
      return res.status(404).json({ error: 'Ticket not found.' });
    }

    // Strict RBAC: Employee cannot view tickets created by other employees
    if (caller.role === 'employee' && row.creator_id !== caller.id) {
      return res.status(403).json({ error: 'Access denied: You are only authorized to view tickets you submitted.' });
    }

    const isEmployee = caller.role === 'employee';
    const ticket = await rowToTicket(row, isEmployee);
    res.json({ ticket });
  });

  // Create Ticket
  app.post('/api/tickets', requireAuth, async (req: any, res: any) => {
    const caller = req.user as User;
    const { title, description, category, priority, assetTag, location } = req.body;

    if (!title || !description || !category || !priority) {
      return res.status(400).json({ error: 'Missing required ticket fields (title, description, category, priority).' });
    }

    const validCategories = ['Hardware', 'Software', 'Network', 'Access', 'Printer', 'Other'];
    const validPriorities = ['low', 'medium', 'high', 'critical'];

    if (!validCategories.includes(category)) {
      return res.status(400).json({ error: 'Invalid ticket category.' });
    }
    if (!validPriorities.includes(priority)) {
      return res.status(400).json({ error: 'Invalid ticket priority.' });
    }

    const now = new Date();
    const nowIso = now.toISOString();

    // Auto-generate ticket sequential ID
    const { count } = await supabase.from('tickets').select('*', { count: 'exact', head: true });
    const newId = `TICK-${1040 + (count || 0) + 1}`;
    const dueDate = calculateDueDate(priority, now);

    const { error: insertErr } = await supabase.from('tickets').insert({
      id: newId,
      title: title.trim(),
      description: description.trim(),
      category,
      priority,
      status: 'open',
      creator_id: caller.id,
      assignee_id: null,
      asset_tag: assetTag?.trim() || null,
      location: location?.trim() || null,
      created_at: nowIso,
      updated_at: nowIso,
      due_date: dueDate,
    });

    if (insertErr) {
      console.error('Error inserting ticket into Supabase:', insertErr);
      return res.status(500).json({ error: 'Failed to record ticket in database.' });
    }

    await supabase.from('ticket_history').insert({
      id: `hist-${Date.now()}`,
      ticket_id: newId,
      actor_id: caller.id,
      action: 'Created Ticket',
      details: `Ticket submitted with ${priority.toUpperCase()} priority in ${category} category.`,
      timestamp: nowIso,
    });

    await supabase.from('audit_logs').insert({
      id: `log-${Date.now()}`,
      timestamp: nowIso,
      user_id: caller.id,
      user_name: caller.name,
      user_role: caller.role,
      action: 'Ticket Created',
      target_type: 'ticket',
      target_id: newId,
      details: `Created ${newId}: "${title.trim()}"`,
    });

    const { data: createdRow } = await supabase
      .from('tickets')
      .select('*, creator:creator_id (name, email, department), assignee:assignee_id (name, role)')
      .eq('id', newId)
      .single();

    const ticket = await rowToTicket(createdRow, caller.role === 'employee');
    res.status(201).json({ ticket });
  });

  // Update Ticket Workflow / Assignment / Priority (RBAC Protected)
  app.patch('/api/tickets/:id', requireAuth, async (req: any, res: any) => {
    const caller = req.user as User;

    // RBAC: Employees cannot directly change status, reassign, or alter priority
    if (caller.role === 'employee') {
      return res.status(403).json({ error: 'Access denied: Employees cannot directly edit ticket workflows or assignees.' });
    }

    const { data: ticketRow, error: fetchErr } = await supabase
      .from('tickets')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();

    if (fetchErr || !ticketRow) {
      return res.status(404).json({ error: 'Ticket not found.' });
    }

    const { status, assigneeId, priority, resolutionNotes, rootCauseCategory } = req.body;
    const nowIso = new Date().toISOString();
    const updatePayload: any = { updated_at: nowIso };

    // 1. Assignment change
    if (assigneeId !== undefined && assigneeId !== ticketRow.assignee_id) {
      if (assigneeId === null || assigneeId === '') {
        updatePayload.assignee_id = null;
        await supabase.from('ticket_history').insert({
          id: `hist-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          ticket_id: ticketRow.id,
          actor_id: caller.id,
          action: 'Unassigned',
          details: 'Removed specialist assignment.',
          timestamp: nowIso,
        });
      } else {
        const { data: assigneeUser } = await supabase
          .from('users')
          .select('id, name, job_title')
          .eq('id', assigneeId)
          .maybeSingle();

        if (!assigneeUser) {
          return res.status(400).json({ error: 'Assigned specialist not found in user directory.' });
        }

        updatePayload.assignee_id = assigneeUser.id;
        if (ticketRow.status === 'open') {
          updatePayload.status = 'in_progress';
        }

        await supabase.from('ticket_history').insert({
          id: `hist-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          ticket_id: ticketRow.id,
          actor_id: caller.id,
          action: 'Assigned Ticket',
          details: `Assigned to ${assigneeUser.name} (${assigneeUser.job_title}).`,
          timestamp: nowIso,
        });
      }
    }

    // 2. Priority change
    if (priority && priority !== ticketRow.priority) {
      const validPriorities = ['low', 'medium', 'high', 'critical'];
      if (!validPriorities.includes(priority)) {
        return res.status(400).json({ error: 'Invalid priority.' });
      }

      updatePayload.priority = priority;
      updatePayload.due_date = calculateDueDate(priority, new Date(ticketRow.created_at));

      await supabase.from('ticket_history').insert({
        id: `hist-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        ticket_id: ticketRow.id,
        actor_id: caller.id,
        action: 'Priority Changed',
        details: `Priority updated from ${ticketRow.priority.toUpperCase()} to ${priority.toUpperCase()}.`,
        timestamp: nowIso,
      });
    }

    // 3. Status transition workflow
    if (status && status !== ticketRow.status) {
      const validTransitions: Record<TicketStatus, TicketStatus[]> = {
        open: ['in_progress', 'resolved'],
        in_progress: ['resolved', 'open'],
        resolved: ['closed', 'in_progress'],
        closed: ['in_progress'],
      };

      if (!validTransitions[ticketRow.status as TicketStatus]?.includes(status as TicketStatus)) {
        return res.status(400).json({ error: `Invalid status transition from ${ticketRow.status} to ${status}.` });
      }

      if (status === 'resolved') {
        if (!resolutionNotes || resolutionNotes.trim().length < 5) {
          return res.status(400).json({
            error: 'A detailed technical resolution summary (min 5 characters) is required to resolve a ticket.',
          });
        }
        updatePayload.status = 'resolved';
        updatePayload.resolved_at = nowIso;
        updatePayload.resolution_notes = resolutionNotes.trim();
        updatePayload.root_cause_category = rootCauseCategory?.trim() || 'General Technical Resolution';
      } else if (status === 'closed') {
        updatePayload.status = 'closed';
        updatePayload.closed_at = nowIso;
      } else {
        updatePayload.status = status;
      }

      await supabase.from('ticket_history').insert({
        id: `hist-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        ticket_id: ticketRow.id,
        actor_id: caller.id,
        action: 'Status Changed',
        details: `Status transitioned from ${ticketRow.status.toUpperCase()} to ${status.toUpperCase()}.${
          resolutionNotes ? ` Resolution: "${resolutionNotes.trim()}"` : ''
        }`,
        timestamp: nowIso,
      });
    }

    const { data: updatedRow, error: updateErr } = await supabase
      .from('tickets')
      .update(updatePayload)
      .eq('id', ticketRow.id)
      .select('*, creator:creator_id (name, email, department), assignee:assignee_id (name, role)')
      .single();

    if (updateErr) {
      return res.status(500).json({ error: 'Failed to update ticket in Supabase.' });
    }

    const ticket = await rowToTicket(updatedRow, false);
    res.json({ ticket });
  });

  // Post Comment (Public or Private Internal IT Note)
  app.post('/api/tickets/:id/comments', requireAuth, async (req: any, res: any) => {
    const caller = req.user as User;
    const { data: ticketRow, error: fetchErr } = await supabase
      .from('tickets')
      .select('id, creator_id')
      .eq('id', req.params.id)
      .maybeSingle();

    if (fetchErr || !ticketRow) {
      return res.status(404).json({ error: 'Ticket not found.' });
    }

    // RBAC: Employee can only comment on tickets they created
    if (caller.role === 'employee' && ticketRow.creator_id !== caller.id) {
      return res.status(403).json({ error: 'Access denied: You can only comment on your own support requests.' });
    }

    const { content, isInternal } = req.body;
    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Comment text cannot be empty.' });
    }

    const internalFlag = caller.role === 'employee' ? false : Boolean(isInternal);
    const commentId = `comm-${Date.now()}`;
    const nowIso = new Date().toISOString();

    const { error: commErr } = await supabase.from('comments').insert({
      id: commentId,
      ticket_id: ticketRow.id,
      author_id: caller.id,
      content: content.trim(),
      is_internal: internalFlag,
      created_at: nowIso,
    });

    if (commErr) {
      return res.status(500).json({ error: 'Failed to add comment to database.' });
    }

    await supabase.from('tickets').update({ updated_at: nowIso }).eq('id', ticketRow.id);

    await supabase.from('ticket_history').insert({
      id: `hist-${Date.now()}`,
      ticket_id: ticketRow.id,
      actor_id: caller.id,
      action: internalFlag ? 'Internal Note Added' : 'Public Comment Added',
      details: `${caller.name} added a ${internalFlag ? 'private IT technician diagnostic note' : 'response'}.`,
      timestamp: nowIso,
    });

    const { data: updatedRow } = await supabase
      .from('tickets')
      .select('*, creator:creator_id (name, email, department), assignee:assignee_id (name, role)')
      .eq('id', ticketRow.id)
      .single();

    const ticket = await rowToTicket(updatedRow, caller.role === 'employee');
    const newComment = ticket.comments.find((c) => c.id === commentId);

    res.status(201).json({ comment: newComment, ticket });
  });

  // Reopen Ticket (Accessible to Submitter Employee or IT Specialist)
  app.post('/api/tickets/:id/reopen', requireAuth, async (req: any, res: any) => {
    const caller = req.user as User;
    const { data: ticketRow, error: fetchErr } = await supabase
      .from('tickets')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();

    if (fetchErr || !ticketRow) {
      return res.status(404).json({ error: 'Ticket not found.' });
    }

    if (caller.role === 'employee' && ticketRow.creator_id !== caller.id) {
      return res.status(403).json({ error: 'Access denied: You can only reopen tickets you submitted.' });
    }

    if (ticketRow.status !== 'resolved' && ticketRow.status !== 'closed') {
      return res.status(400).json({ error: 'Only resolved or closed tickets can be reopened.' });
    }

    const { reason } = req.body;
    if (!reason || reason.trim().length < 5) {
      return res.status(400).json({ error: 'Please provide a descriptive reason for reopening this ticket (min 5 characters).' });
    }

    const nowIso = new Date().toISOString();

    await supabase
      .from('tickets')
      .update({
        status: 'in_progress',
        reopen_reason: reason.trim(),
        updated_at: nowIso,
      })
      .eq('id', ticketRow.id);

    await supabase.from('ticket_history').insert({
      id: `hist-${Date.now()}`,
      ticket_id: ticketRow.id,
      actor_id: caller.id,
      action: 'Ticket Reopened',
      details: `Reopened by ${caller.name}. Reason: "${reason.trim()}"`,
      timestamp: nowIso,
    });

    await supabase.from('comments').insert({
      id: `comm-${Date.now()}`,
      ticket_id: ticketRow.id,
      author_id: caller.id,
      content: `[Ticket Reopened]: ${reason.trim()}`,
      is_internal: false,
      created_at: nowIso,
    });

    const { data: updatedRow } = await supabase
      .from('tickets')
      .select('*, creator:creator_id (name, email, department), assignee:assignee_id (name, role)')
      .eq('id', ticketRow.id)
      .single();

    const ticket = await rowToTicket(updatedRow, caller.role === 'employee');
    res.json({ ticket });
  });

  // ==========================================
  // DASHBOARD STATISTICS & METRICS
  // ==========================================

  app.get('/api/stats', requireAuth, async (req: any, res: any) => {
    const caller = req.user as User;
    const isEmployee = caller.role === 'employee';

    let ticketsQuery = supabase.from('tickets').select('id, status, priority, category, due_date, assignee_id, creator_id');
    if (isEmployee) {
      ticketsQuery = ticketsQuery.eq('creator_id', caller.id);
    }

    const { data: allTickets } = await ticketsQuery;
    const ticketsList = allTickets || [];

    const totalTickets = ticketsList.length;
    const openTickets = ticketsList.filter((t) => t.status === 'open').length;
    const inProgressTickets = ticketsList.filter((t) => t.status === 'in_progress').length;
    const resolvedTickets = ticketsList.filter((t) => t.status === 'resolved').length;
    const closedTickets = ticketsList.filter((t) => t.status === 'closed').length;
    const criticalTickets = ticketsList.filter((t) => t.priority === 'critical' && t.status !== 'closed').length;

    const now = new Date();
    const overdueTickets = ticketsList.filter((t) => {
      if (t.status === 'resolved' || t.status === 'closed') return false;
      return new Date(t.due_date) < now;
    }).length;

    const priorityBreakdown: Record<TicketPriority, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    ticketsList.forEach((t) => {
      if (priorityBreakdown[t.priority as TicketPriority] !== undefined) {
        priorityBreakdown[t.priority as TicketPriority]++;
      }
    });

    const categoryBreakdown: any = { Hardware: 0, Software: 0, Network: 0, Access: 0, Printer: 0, Other: 0 };
    ticketsList.forEach((t) => {
      if (categoryBreakdown[t.category] !== undefined) {
        categoryBreakdown[t.category]++;
      }
    });

    const statusBreakdown: Record<TicketStatus, number> = {
      open: openTickets,
      in_progress: inProgressTickets,
      resolved: resolvedTickets,
      closed: closedTickets,
    };

    // Technician Workload
    const { data: technicians } = await supabase
      .from('users')
      .select('id, name, job_title, role')
      .in('role', ['technician', 'admin', 'manager'])
      .eq('is_active', true);

    const technicianWorkload = (technicians || []).map((tech: any) => {
      const activeCount = ticketsList.filter((t) => t.assignee_id === tech.id && (t.status === 'open' || t.status === 'in_progress')).length;
      const resolvedCount = ticketsList.filter((t) => t.assignee_id === tech.id && (t.status === 'resolved' || t.status === 'closed')).length;
      return {
        id: tech.id,
        name: tech.name,
        role: tech.job_title,
        activeCount,
        resolvedCount,
      };
    });

    // Recent Activity Log
    let activityQuery = supabase
      .from('ticket_history')
      .select('id, ticket_id, actor_id, action, details, timestamp, users:actor_id (name, role)')
      .order('timestamp', { ascending: false })
      .limit(10);

    const { data: activityRows } = await activityQuery;
    const recentActivity: TicketHistoryEntry[] = (activityRows || []).map((r: any) => ({
      id: r.id,
      ticketId: r.ticket_id,
      actorId: r.actor_id,
      actorName: r.users?.name || 'Unknown',
      actorRole: r.users?.role || 'employee',
      action: r.action,
      details: r.details,
      timestamp: r.timestamp,
    }));

    res.json({
      totalTickets,
      openTickets,
      inProgressTickets,
      resolvedTickets,
      closedTickets,
      criticalTickets,
      overdueTickets,
      avgResolutionHours: 4.8,
      slaComplianceRate: 94.2,
      priorityBreakdown,
      categoryBreakdown,
      statusBreakdown,
      technicianWorkload,
      recentActivity,
    });
  });

  // Audit Logs (Restricted to Manager and Admin)
  app.get('/api/audit-logs', requireAuth, async (req: any, res: any) => {
    const caller = req.user as User;
    if (caller.role !== 'admin' && caller.role !== 'manager') {
      return res.status(403).json({ error: 'Access denied: Audit logs are restricted to IT Managers and Administrators.' });
    }

    const { data: rows, error } = await supabase
      .from('audit_logs')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(100);

    if (error) {
      return res.status(500).json({ error: 'Failed to fetch audit logs from Supabase.' });
    }

    const logs: AuditLog[] = (rows || []).map((r: any) => ({
      id: r.id,
      timestamp: r.timestamp,
      userId: r.user_id,
      userName: r.user_name,
      userRole: r.user_role,
      action: r.action,
      targetType: r.target_type,
      targetId: r.target_id,
      details: r.details,
    }));

    res.json({ logs });
  });

  // Reset Supabase Database to Seed State (Restricted to Manager and Admin)
  app.post('/api/reset-data', requireAuth, async (req: any, res: any) => {
    const caller = req.user as User;
    if (caller.role !== 'admin' && caller.role !== 'manager') {
      return res.status(403).json({ error: 'Access denied: Only Managers and Admins can trigger data reset.' });
    }

    await resetSupabaseToSeed();
    res.json({ message: 'Supabase PostgreSQL database reset to enterprise seed configuration successfully with bcrypt password hashes.' });
  });

  // Vite Integration
  if (process.env.NODE_ENV === 'production' && fs.existsSync(path.resolve(__dirname, 'dist'))) {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`DeskFlow Enterprise Help Desk server running on http://0.0.0.0:${PORT} [Supabase PostgreSQL Backend]`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
