import {
  User,
  Ticket,
  DashboardStats,
  AuditLog,
  CreateTicketDTO,
  UpdateTicketDTO,
  RegisterDTO,
  AuthResponse,
} from '../types.ts';
import { SEED_USERS } from './seedData.ts';

const SESSION_TOKEN_KEY = 'deskflow_session_token';
const SESSION_USER_KEY = 'deskflow_session_user';
export const DEFAULT_DEMO_PASSWORD = 'DeskFlow2026!';

class ApiService {
  private token: string | null = null;
  private currentUser: User | null = null;
  private onUnauthorizedCallback: (() => void) | null = null;

  constructor() {
    this.token = localStorage.getItem(SESSION_TOKEN_KEY);
    const storedUser = localStorage.getItem(SESSION_USER_KEY);
    if (storedUser && this.token) {
      try {
        this.currentUser = JSON.parse(storedUser);
      } catch {
        this.currentUser = null;
        this.token = null;
      }
    }
  }

  setOnUnauthorized(callback: () => void) {
    this.onUnauthorizedCallback = callback;
  }

  getCurrentUser(): User | null {
    return this.currentUser;
  }

  getToken(): string | null {
    return this.token;
  }

  private getHeaders(): HeadersInit {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    return headers;
  }

  private handleUnauthorized() {
    this.token = null;
    this.currentUser = null;
    localStorage.removeItem(SESSION_TOKEN_KEY);
    localStorage.removeItem(SESSION_USER_KEY);
    if (this.onUnauthorizedCallback) {
      this.onUnauthorizedCallback();
    }
  }

  // Login with Email and Password (Verifies bcrypt hash on server and gets session token)
  async login(email: string, password = DEFAULT_DEMO_PASSWORD): Promise<User> {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Authentication failed' }));
      throw new Error(err.error || 'Invalid corporate credentials');
    }

    const data: AuthResponse = await res.json();
    this.token = data.token;
    this.currentUser = data.user;
    localStorage.setItem(SESSION_TOKEN_KEY, data.token);
    localStorage.setItem(SESSION_USER_KEY, JSON.stringify(data.user));
    return data.user;
  }

  // Quick Persona Login: Authenticates demo persona using real email & bcrypt password verification
  async loginAsDemoPersona(userIdOrEmail: string): Promise<User> {
    const seedUser = SEED_USERS.find(
      (u) => u.id === userIdOrEmail || u.email.toLowerCase() === userIdOrEmail.toLowerCase()
    );
    const email = seedUser ? seedUser.email : userIdOrEmail;
    return this.login(email, DEFAULT_DEMO_PASSWORD);
  }

  // Register New Employee User
  async register(registerData: RegisterDTO): Promise<User> {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(registerData),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Registration failed' }));
      throw new Error(err.error || 'Failed to register account');
    }

    const data: AuthResponse = await res.json();
    this.token = data.token;
    this.currentUser = data.user;
    localStorage.setItem(SESSION_TOKEN_KEY, data.token);
    localStorage.setItem(SESSION_USER_KEY, JSON.stringify(data.user));
    return data.user;
  }

  async logout(): Promise<void> {
    if (this.token) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: this.getHeaders(),
        });
      } catch (err) {
        console.warn('Logout network call failed:', err);
      }
    }
    this.handleUnauthorized();
  }

  async getCurrentProfile(): Promise<User | null> {
    if (!this.token) return null;
    try {
      const res = await fetch('/api/auth/me', {
        headers: this.getHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        this.currentUser = data.user;
        localStorage.setItem(SESSION_USER_KEY, JSON.stringify(data.user));
        return data.user;
      } else if (res.status === 401) {
        this.handleUnauthorized();
        return null;
      }
    } catch {
      // Offline fallback
    }
    return this.currentUser;
  }

  async getUsers(): Promise<User[]> {
    const res = await fetch('/api/users', {
      headers: this.getHeaders(),
    });
    if (res.status === 401) {
      this.handleUnauthorized();
      throw new Error('Session expired. Please log in again.');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to fetch users' }));
      throw new Error(err.error || 'Failed to fetch users');
    }
    const data = await res.json();
    return data.users;
  }

  async createUser(userData: {
    name: string;
    email: string;
    role: string;
    department: string;
    jobTitle: string;
    phone?: string;
    password?: string;
  }): Promise<User> {
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(userData),
    });
    if (res.status === 401) {
      this.handleUnauthorized();
      throw new Error('Session expired. Please log in again.');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to create user' }));
      throw new Error(err.error || 'Failed to create user');
    }
    const data = await res.json();
    return data.user;
  }

  async updateUser(id: string, updates: Partial<User> & { password?: string }): Promise<User> {
    const res = await fetch(`/api/users/${id}`, {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: JSON.stringify(updates),
    });
    if (res.status === 401) {
      this.handleUnauthorized();
      throw new Error('Session expired. Please log in again.');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to update user' }));
      throw new Error(err.error || 'Failed to update user');
    }
    const data = await res.json();
    return data.user;
  }

  async getTickets(params: {
    search?: string;
    status?: string;
    category?: string;
    priority?: string;
    assigneeId?: string;
    myTicketsOnly?: boolean;
    slaStatus?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    page?: number;
    limit?: number;
  }): Promise<{ tickets: Ticket[]; pagination: { total: number; page: number; limit: number; totalPages: number } }> {
    const query = new URLSearchParams();
    if (params.search) query.set('search', params.search);
    if (params.status) query.set('status', params.status);
    if (params.category) query.set('category', params.category);
    if (params.priority) query.set('priority', params.priority);
    if (params.assigneeId) query.set('assigneeId', params.assigneeId);
    if (params.myTicketsOnly) query.set('myTicketsOnly', 'true');
    if (params.slaStatus) query.set('slaStatus', params.slaStatus);
    if (params.sortBy) query.set('sortBy', params.sortBy);
    if (params.sortOrder) query.set('sortOrder', params.sortOrder);
    if (params.page) query.set('page', params.page.toString());
    if (params.limit) query.set('limit', params.limit.toString());

    const res = await fetch(`/api/tickets?${query.toString()}`, {
      headers: this.getHeaders(),
    });

    if (res.status === 401) {
      this.handleUnauthorized();
      throw new Error('Session expired. Please log in again.');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to fetch tickets' }));
      throw new Error(err.error || 'Failed to fetch tickets');
    }

    return await res.json();
  }

  async getTicket(id: string): Promise<Ticket> {
    const res = await fetch(`/api/tickets/${id}`, {
      headers: this.getHeaders(),
    });
    if (res.status === 401) {
      this.handleUnauthorized();
      throw new Error('Session expired. Please log in again.');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to fetch ticket' }));
      throw new Error(err.error || 'Failed to fetch ticket');
    }
    const data = await res.json();
    return data.ticket;
  }

  async createTicket(ticketData: CreateTicketDTO): Promise<Ticket> {
    const res = await fetch('/api/tickets', {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(ticketData),
    });
    if (res.status === 401) {
      this.handleUnauthorized();
      throw new Error('Session expired. Please log in again.');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to create ticket' }));
      throw new Error(err.error || 'Failed to create ticket');
    }
    const data = await res.json();
    return data.ticket;
  }

  async updateTicket(id: string, updates: UpdateTicketDTO): Promise<Ticket> {
    const res = await fetch(`/api/tickets/${id}`, {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: JSON.stringify(updates),
    });
    if (res.status === 401) {
      this.handleUnauthorized();
      throw new Error('Session expired. Please log in again.');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to update ticket' }));
      throw new Error(err.error || 'Failed to update ticket');
    }
    const data = await res.json();
    return data.ticket;
  }

  async addComment(ticketId: string, content: string, isInternal: boolean): Promise<Ticket> {
    const res = await fetch(`/api/tickets/${ticketId}/comments`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ content, isInternal }),
    });
    if (res.status === 401) {
      this.handleUnauthorized();
      throw new Error('Session expired. Please log in again.');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to post comment' }));
      throw new Error(err.error || 'Failed to post comment');
    }
    const data = await res.json();
    return data.ticket;
  }

  async reopenTicket(ticketId: string, reason: string): Promise<Ticket> {
    const res = await fetch(`/api/tickets/${ticketId}/reopen`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ reason }),
    });
    if (res.status === 401) {
      this.handleUnauthorized();
      throw new Error('Session expired. Please log in again.');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to reopen ticket' }));
      throw new Error(err.error || 'Failed to reopen ticket');
    }
    const data = await res.json();
    return data.ticket;
  }

  async getStats(): Promise<DashboardStats> {
    const res = await fetch('/api/stats', {
      headers: this.getHeaders(),
    });
    if (res.status === 401) {
      this.handleUnauthorized();
      throw new Error('Session expired. Please log in again.');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to fetch stats' }));
      throw new Error(err.error || 'Failed to fetch statistics');
    }
    return await res.json();
  }

  async getAuditLogs(): Promise<AuditLog[]> {
    const res = await fetch('/api/audit-logs', {
      headers: this.getHeaders(),
    });
    if (res.status === 401) {
      this.handleUnauthorized();
      throw new Error('Session expired. Please log in again.');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to fetch audit logs' }));
      throw new Error(err.error || 'Failed to fetch audit logs');
    }
    const data = await res.json();
    return data.logs;
  }

  async resetData(): Promise<void> {
    const res = await fetch('/api/reset-data', {
      method: 'POST',
      headers: this.getHeaders(),
    });
    if (res.status === 401) {
      this.handleUnauthorized();
      throw new Error('Session expired. Please log in again.');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to reset database' }));
      throw new Error(err.error || 'Failed to reset database');
    }
  }
}

export const api = new ApiService();
