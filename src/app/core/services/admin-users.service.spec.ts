import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { AdminUsersService } from './admin-users.service';
import { SupabaseService } from './supabase.service';

describe('AdminUsersService', () => {
  let service: AdminUsersService;
  let rpcSpy: ReturnType<typeof vi.fn>;
  let invokeSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    rpcSpy = vi.fn();
    invokeSpy = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: SupabaseService, useValue: { client: { rpc: rpcSpy, functions: { invoke: invokeSpy } } } },
      ],
    });
    service = TestBed.inject(AdminUsersService);
  });

  it('loads users via get_users_for_admin', async () => {
    rpcSpy.mockResolvedValue({
      data: [
        {
          id: 'user-1',
          email: 'alex@example.com',
          display_name: 'Alex',
          role: 'user',
          suspended: false,
          created_at: '2026-08-01T00:00:00Z',
        },
      ],
      error: null,
    });

    await service.loadUsers();

    expect(rpcSpy).toHaveBeenCalledWith('get_users_for_admin');
    expect(service.users()).toEqual([
      {
        id: 'user-1',
        email: 'alex@example.com',
        displayName: 'Alex',
        role: 'user',
        suspended: false,
        createdAt: '2026-08-01T00:00:00Z',
      },
    ]);
  });

  it('throws when loadUsers errors', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: new Error('boom') });

    await expect(service.loadUsers()).rejects.toThrow('boom');
  });

  it('updates a role and reflects it locally without reloading', async () => {
    service.users.set([
      {
        id: 'user-1',
        email: 'alex@example.com',
        displayName: 'Alex',
        role: 'user',
        suspended: false,
        createdAt: '2026-08-01T00:00:00Z',
      },
    ]);
    rpcSpy.mockResolvedValue({ data: null, error: null });

    await service.updateRole('user-1', 'moderator');

    expect(rpcSpy).toHaveBeenCalledWith('admin_update_user_role', { target_user_id: 'user-1', new_role: 'moderator' });
    expect(service.users()[0].role).toBe('moderator');
  });

  it('throws when updateRole errors', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: new Error('cannot modify your own role') });

    await expect(service.updateRole('user-1', 'admin')).rejects.toThrow('cannot modify your own role');
  });

  it('sets suspended and reflects it locally', async () => {
    service.users.set([
      {
        id: 'user-1',
        email: 'alex@example.com',
        displayName: 'Alex',
        role: 'user',
        suspended: false,
        createdAt: '2026-08-01T00:00:00Z',
      },
    ]);
    rpcSpy.mockResolvedValue({ data: null, error: null });

    await service.setSuspended('user-1', true);

    expect(rpcSpy).toHaveBeenCalledWith('admin_set_user_suspended', { target_user_id: 'user-1', is_suspended: true });
    expect(service.users()[0].suspended).toBe(true);
  });

  it('throws when setSuspended errors', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: new Error('boom') });

    await expect(service.setSuspended('user-1', true)).rejects.toThrow('boom');
  });

  it('deletes a user via the admin-delete-account function and removes it locally', async () => {
    service.users.set([
      {
        id: 'user-1',
        email: 'alex@example.com',
        displayName: 'Alex',
        role: 'user',
        suspended: false,
        createdAt: '2026-08-01T00:00:00Z',
      },
    ]);
    invokeSpy.mockResolvedValue({ error: null });

    await service.deleteUser('user-1');

    expect(invokeSpy).toHaveBeenCalledWith('admin-delete-account', { body: { target_user_id: 'user-1' } });
    expect(service.users()).toEqual([]);
  });

  it('throws when deleteUser errors', async () => {
    invokeSpy.mockResolvedValue({ error: new Error('boom') });

    await expect(service.deleteUser('user-1')).rejects.toThrow('boom');
  });

  it('surfaces the Edge Function response body when deleteUser gets a FunctionsHttpError', async () => {
    invokeSpy.mockResolvedValue({
      error: new FunctionsHttpError({ text: () => Promise.resolve('Forbidden') }),
    });

    await expect(service.deleteUser('user-1')).rejects.toThrow('Forbidden');
  });
});
