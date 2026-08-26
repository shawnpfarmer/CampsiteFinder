import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { Router } from '@angular/router';
import { adminGuard } from './admin.guard';
import { SupabaseService } from '../services/supabase.service';
import { UserService } from '../services/user.service';

describe('adminGuard', () => {
  function setup(opts: {
    isAuthenticated: boolean;
    profile: { role: string } | null;
    loadProfile?: () => Promise<void>;
  }) {
    const parseUrlSpy = vi.fn().mockReturnValue('parsed-url');
    TestBed.configureTestingModule({
      providers: [
        { provide: SupabaseService, useValue: { isAuthenticated: opts.isAuthenticated } },
        {
          provide: UserService,
          useValue: {
            profile: () => opts.profile,
            loadProfile: opts.loadProfile ?? vi.fn().mockResolvedValue(undefined),
          },
        },
        { provide: Router, useValue: { parseUrl: parseUrlSpy } },
      ],
    });
    return { parseUrlSpy };
  }

  it('redirects to /login when not authenticated', async () => {
    const { parseUrlSpy } = setup({ isAuthenticated: false, profile: null });

    const result = await TestBed.runInInjectionContext(() => adminGuard({} as any, {} as any));

    expect(parseUrlSpy).toHaveBeenCalledWith('/login');
    expect(result).toBe('parsed-url');
  });

  it('allows navigation when authenticated with an admin profile already loaded', async () => {
    setup({ isAuthenticated: true, profile: { role: 'admin' } });

    const result = await TestBed.runInInjectionContext(() => adminGuard({} as any, {} as any));

    expect(result).toBe(true);
  });

  it('redirects to / when authenticated but not an admin', async () => {
    const { parseUrlSpy } = setup({ isAuthenticated: true, profile: { role: 'user' } });

    const result = await TestBed.runInInjectionContext(() => adminGuard({} as any, {} as any));

    expect(parseUrlSpy).toHaveBeenCalledWith('/');
    expect(result).toBe('parsed-url');
  });

  it('loads the profile first when it has not been loaded yet', async () => {
    let profile: { role: string } | null = null;
    const loadProfile = vi.fn().mockImplementation(async () => {
      profile = { role: 'admin' };
    });
    TestBed.configureTestingModule({
      providers: [
        { provide: SupabaseService, useValue: { isAuthenticated: true } },
        { provide: UserService, useValue: { profile: () => profile, loadProfile } },
        { provide: Router, useValue: { parseUrl: vi.fn() } },
      ],
    });

    const result = await TestBed.runInInjectionContext(() => adminGuard({} as any, {} as any));

    expect(loadProfile).toHaveBeenCalled();
    expect(result).toBe(true);
  });
});
