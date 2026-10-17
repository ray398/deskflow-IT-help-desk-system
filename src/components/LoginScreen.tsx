import React, { useState } from 'react';
import { User, UserRole, RegisterDTO } from '../types.ts';
import { SEED_USERS } from '../services/seedData.ts';
import { DEFAULT_DEMO_PASSWORD } from '../services/api.ts';
import {
  Layers,
  Shield,
  Briefcase,
  Wrench,
  User as UserIcon,
  ArrowRight,
  Lock,
  Mail,
  AlertCircle,
  CheckCircle,
  Eye,
  EyeOff,
  UserPlus,
} from 'lucide-react';

interface LoginScreenProps {
  onLogin: (email: string, password?: string) => Promise<void>;
  onRegister: (data: RegisterDTO) => Promise<void>;
}

export function LoginScreen({ onLogin, onRegister }: LoginScreenProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');

  // Login form state
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState(DEFAULT_DEMO_PASSWORD);
  const [showPassword, setShowPassword] = useState(false);

  // Register form state
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regDept, setRegDept] = useState('');
  const [regJobTitle, setRegJobTitle] = useState('');
  const [regPhone, setRegPhone] = useState('');

  const [loadingUser, setLoadingUser] = useState<string | null>(null);
  const [error, setError] = useState('');

  const demoPersonas: Array<{
    user: User;
    description: string;
    capabilities: string[];
    roleBadgeClass: string;
  }> = [
    {
      user: SEED_USERS[0], // Sarah Chen - Employee
      description: 'Senior Financial Analyst in Finance & Accounting',
      capabilities: [
        'Submit hardware/access support requests',
        'Track own tickets & view technician updates',
        'Reopen tickets if issues recur',
      ],
      roleBadgeClass: 'bg-slate-100 text-slate-700 border-slate-200',
    },
    {
      user: SEED_USERS[1], // Alex Rivera - Technician
      description: 'Tier 2 Systems Specialist in IT Support & Infrastructure',
      capabilities: [
        'Claim unassigned support requests',
        'Progress workflow (Open → In Progress → Resolved)',
        'Add private internal technician diagnostics',
      ],
      roleBadgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    },
    {
      user: SEED_USERS[2], // Marcus Vance - IT Manager
      description: 'IT Operations & Service Desk Operations Manager',
      capabilities: [
        'Full team queue & technician capacity oversight',
        'Monitor SLA breaches & MTTR analytics',
        'Reassign tickets across specialists',
      ],
      roleBadgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
    },
    {
      user: SEED_USERS[3], // Elena Rostova - Admin
      description: 'Lead Enterprise Systems & IAM Administrator',
      capabilities: [
        'Provision corporate user accounts & roles',
        'Inspect immutable security audit logs',
        'Full system access and data configuration',
      ],
      roleBadgeClass: 'bg-purple-50 text-purple-700 border-purple-200',
    },
  ];

  const handleSelectPersona = async (email: string, userId: string) => {
    setLoadingUser(userId);
    setError('');
    try {
      await onLogin(email, DEFAULT_DEMO_PASSWORD);
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setLoadingUser(null);
    }
  };

  const handleLoginFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailInput.trim()) {
      setError('Please enter your corporate email address.');
      return;
    }
    if (!passwordInput) {
      setError('Please enter your password.');
      return;
    }
    setLoadingUser('form');
    setError('');
    try {
      await onLogin(emailInput.trim(), passwordInput);
    } catch (err: any) {
      setError(err.message || 'Invalid email or password.');
    } finally {
      setLoadingUser(null);
    }
  };

  const handleRegisterFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regName.trim() || !regEmail.trim() || !regPassword || !regDept.trim() || !regJobTitle.trim()) {
      setError('Please complete all required fields.');
      return;
    }
    if (regPassword.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }
    setLoadingUser('register');
    setError('');
    try {
      await onRegister({
        name: regName.trim(),
        email: regEmail.trim(),
        password: regPassword,
        department: regDept.trim(),
        jobTitle: regJobTitle.trim(),
        phone: regPhone.trim() || undefined,
      });
    } catch (err: any) {
      setError(err.message || 'Registration failed');
    } finally {
      setLoadingUser(null);
    }
  };

  const getRoleIcon = (role: UserRole) => {
    switch (role) {
      case 'admin':
        return <Shield className="w-4 h-4 text-purple-600" />;
      case 'manager':
        return <Briefcase className="w-4 h-4 text-blue-600" />;
      case 'technician':
        return <Wrench className="w-4 h-4 text-indigo-600" />;
      case 'employee':
      default:
        return <UserIcon className="w-4 h-4 text-slate-500" />;
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center p-4 sm:p-6 lg:p-12 text-slate-100 select-none">
      <div className="max-w-4xl w-full space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-indigo-600 text-white shadow-lg mb-1">
            <Layers className="w-7 h-7" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            DeskFlow Enterprise IT Help Desk
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 max-w-lg mx-auto">
            Corporate IT Service Management powered by a secure relational database,
            bcrypt password hashing, and server-enforced role permissions.
          </p>
        </div>

        {error && (
          <div className="p-3.5 rounded-lg bg-rose-950/80 border border-rose-800 text-rose-200 text-xs flex items-center gap-2.5 max-w-xl mx-auto shadow-sm">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        {/* Demo Personas Grid */}
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-slate-400 px-1">
            <span className="font-semibold uppercase tracking-wider text-slate-300">
              Demo Persona Quick Authentication (Bcrypt Verified)
            </span>
            <span className="text-indigo-400">Default Password: DeskFlow2026!</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {demoPersonas.map(({ user, description, capabilities, roleBadgeClass }) => {
              const isLoading = loadingUser === user.id;
              return (
                <div
                  key={user.id}
                  onClick={() => handleSelectPersona(user.email, user.id)}
                  className="bg-slate-900/90 hover:bg-slate-900 border border-slate-800 hover:border-indigo-500/60 rounded-xl p-5 cursor-pointer transition-all hover:shadow-xl group flex flex-col justify-between"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-sm text-indigo-300 group-hover:bg-indigo-950 transition-colors">
                          {user.name
                            .split(' ')
                            .map((n) => n[0])
                            .join('')}
                        </div>
                        <div>
                          <div className="font-bold text-white text-sm group-hover:text-indigo-300 transition-colors">
                            {user.name}
                          </div>
                          <div className="text-xs text-slate-400">{user.jobTitle}</div>
                        </div>
                      </div>

                      <span
                        className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded border capitalize ${roleBadgeClass}`}
                      >
                        {getRoleIcon(user.role)}
                        {user.role}
                      </span>
                    </div>

                    <div className="text-xs text-slate-300">{description}</div>

                    <div className="pt-2 border-t border-slate-800/80 space-y-1">
                      {capabilities.map((cap, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-2 text-[11px] text-slate-400"
                        >
                          <CheckCircle className="w-3 h-3 text-indigo-400 shrink-0" />
                          <span>{cap}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between text-xs font-semibold text-indigo-400 group-hover:text-indigo-300">
                    <span>{isLoading ? 'Hashing & Authenticating...' : `Log In as ${user.name}`}</span>
                    <ArrowRight className="w-4 h-4 transform group-hover:translate-x-1 transition-transform" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Corporate Sign In / Register Tabbed Box */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 max-w-lg mx-auto space-y-4">
          <div className="flex items-center border-b border-slate-800">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError('');
              }}
              className={`pb-2.5 px-3 text-xs font-semibold transition-colors border-b-2 ${
                mode === 'login'
                  ? 'border-indigo-500 text-indigo-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Sign In with Credentials
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError('');
              }}
              className={`pb-2.5 px-3 text-xs font-semibold transition-colors border-b-2 flex items-center gap-1.5 ${
                mode === 'register'
                  ? 'border-indigo-500 text-indigo-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Register Employee Account</span>
            </button>
          </div>

          {mode === 'login' ? (
            <form onSubmit={handleLoginFormSubmit} className="space-y-3 text-xs">
              <div className="space-y-1">
                <label className="block text-slate-400 font-medium">Corporate Email</label>
                <div className="relative">
                  <Mail className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
                  <input
                    type="email"
                    required
                    placeholder="e.g. sarah.chen@enterprise.corp"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 rounded-md bg-slate-950 border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="block text-slate-400 font-medium">Password</label>
                  <span className="text-[11px] text-slate-500">Demo: DeskFlow2026!</span>
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    className="w-full pl-9 pr-10 py-2 rounded-md bg-slate-950 border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-2.5 text-slate-500 hover:text-slate-300"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loadingUser === 'form'}
                className="w-full py-2.5 rounded-md font-semibold bg-indigo-600 hover:bg-indigo-500 text-white text-xs shadow-md transition-colors disabled:opacity-50 mt-2"
              >
                {loadingUser === 'form' ? 'Verifying Credentials...' : 'Sign In'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleRegisterFormSubmit} className="space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-slate-400 font-medium">Full Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Jordan Hayes"
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    className="w-full p-2 rounded-md bg-slate-950 border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-slate-400 font-medium">Corporate Email *</label>
                  <input
                    type="email"
                    required
                    placeholder="jordan.hayes@enterprise.corp"
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    className="w-full p-2 rounded-md bg-slate-950 border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-slate-400 font-medium">Department *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Product Engineering"
                    value={regDept}
                    onChange={(e) => setRegDept(e.target.value)}
                    className="w-full p-2 rounded-md bg-slate-950 border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-slate-400 font-medium">Job Title *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. QA Automation Engineer"
                    value={regJobTitle}
                    onChange={(e) => setRegJobTitle(e.target.value)}
                    className="w-full p-2 rounded-md bg-slate-950 border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-slate-400 font-medium">Password (min 8 chars) *</label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    placeholder="Secure password"
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    className="w-full p-2 rounded-md bg-slate-950 border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-slate-400 font-medium">Desk Phone (Optional)</label>
                  <input
                    type="text"
                    placeholder="+1 (555) 019-..."
                    value={regPhone}
                    onChange={(e) => setRegPhone(e.target.value)}
                    className="w-full p-2 rounded-md bg-slate-950 border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loadingUser === 'register'}
                className="w-full py-2.5 rounded-md font-semibold bg-emerald-600 hover:bg-emerald-500 text-white text-xs shadow-md transition-colors disabled:opacity-50 mt-2"
              >
                {loadingUser === 'register' ? 'Creating Account & Session...' : 'Complete Employee Registration'}
              </button>
            </form>
          )}
        </div>

        {/* Footer info */}
        <div className="text-center text-[11px] text-slate-500">
          DeskFlow Enterprise Help Desk · Relational SQLite Storage · Bcrypt Hash & Bearer Session Tokens
        </div>
      </div>
    </div>
  );
}
