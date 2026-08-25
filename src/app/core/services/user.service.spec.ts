import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { UserService } from './user.service';
import { SupabaseService } from './supabase.service';

function createQueryBuilderMock(result: { data?: any; error?: any }) {
  const builder: any = {};
  ['select', 'update', 'eq'].forEach((method) => {
    builder[method] = vi.fn().mockReturnValue(builder);
  });
  builder.single = vi.fn().mockResolvedValue(result);
  builder.then = (resolve: any) => resolve(result);
  return builder;
}

describe('UserService', () => {
  let service: UserService;
  let fromSpy: ReturnType<typeof vi.fn>;
  let updateUserSpy: ReturnType<typeof vi.fn>;
  let signOutSpy: ReturnType<typeof vi.fn>;
  let invokeSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Clean up DOM state to prevent test leakage
    delete document.documentElement.dataset['theme'];

    fromSpy = vi.fn();
    updateUserSpy = vi.fn().mockResolvedValue({ error: null });
    signOutSpy = vi.fn().mockResolvedValue({ error: null });
    invokeSpy = vi.fn().mockResolvedValue({ error: null });
    TestBed.configureTestingModule({
      providers: [
        {
          provide: SupabaseService,
          useValue: {
            session: () => ({ user: { id: 'user-1' } }),
            client: {
              from: fromSpy,
              auth: { updateUser: updateUserSpy, signOut: signOutSpy },
              functions: { invoke: invokeSpy },
            },
          },
        },
      ],
    });
    service = TestBed.inject(UserService);
  });

  it('loads the profile for the signed-in user', async () => {
    fromSpy.mockReturnValue(
      createQueryBuilderMock({
        data: { id: 'user-1', display_name: 'Alex', theme: 'dark', role: 'user' },
        error: null,
      }),
    );

    await service.loadProfile();

    expect(service.profile()).toEqual({ id: 'user-1', displayName: 'Alex', theme: 'dark', role: 'user' });
  });

  it('sets profile to null when signed out', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: SupabaseService,
          useValue: { session: () => null, client: { from: fromSpy } },
        },
      ],
    });
    service = TestBed.inject(UserService);

    await service.loadProfile();

    expect(service.profile()).toBeNull();
  });

  it('updates display name in the table and syncs auth metadata', async () => {
    fromSpy.mockReturnValue(createQueryBuilderMock({ data: null, error: null }));

    await service.updateDisplayName('New Name');

    expect(fromSpy).toHaveBeenCalledWith('users');
    expect(updateUserSpy).toHaveBeenCalledWith({ data: { display_name: 'New Name' } });
  });

  it('updates password via supabase auth', async () => {
    await service.updatePassword('new-password-123');

    expect(updateUserSpy).toHaveBeenCalledWith({ password: 'new-password-123' });
  });

  it('updates theme in the table', async () => {
    fromSpy.mockReturnValue(createQueryBuilderMock({ data: null, error: null }));

    await service.updateTheme('dark');

    expect(fromSpy).toHaveBeenCalledWith('users');
  });

  it('invokes the delete-account function and signs out', async () => {
    await service.deleteAccount();

    expect(invokeSpy).toHaveBeenCalledWith('delete-account');
    expect(signOutSpy).toHaveBeenCalled();
    expect(service.profile()).toBeNull();
  });

  it('throws and does not sign out when delete-account fails', async () => {
    invokeSpy.mockResolvedValue({ error: new Error('boom') });

    await expect(service.deleteAccount()).rejects.toThrow('boom');
    expect(signOutSpy).not.toHaveBeenCalled();
  });

  it('applies persisted theme to DOM when loading profile with non-null theme', async () => {
    fromSpy.mockReturnValue(
      createQueryBuilderMock({
        data: { id: 'user-1', display_name: 'Alex', theme: 'dark', role: 'user' },
        error: null,
      }),
    );

    await service.loadProfile();

    expect(document.documentElement.dataset['theme']).toBe('dark');
  });

  it('does not set DOM theme attribute when loading profile with null theme', async () => {
    fromSpy.mockReturnValue(
      createQueryBuilderMock({
        data: { id: 'user-1', display_name: 'Alex', theme: null, role: 'user' },
        error: null,
      }),
    );

    await service.loadProfile();

    expect(document.documentElement.dataset['theme']).toBeUndefined();
  });
});
