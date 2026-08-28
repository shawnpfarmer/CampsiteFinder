import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { AdminComponent } from './admin.component';
import { AdminUsersService } from '../../core/services/admin-users.service';
import { CampgroundAttributesService } from '../../core/services/campground-attributes.service';
import { CampgroundsService } from '../../core/services/campgrounds.service';
import { AdminUser } from '../../core/models/admin-user.model';
import { signal } from '@angular/core';

describe('AdminComponent', () => {
  function setup(overrides: { users?: AdminUser[] } = {}) {
    const loadUsersSpy = vi.fn().mockResolvedValue(undefined);
    const updateRoleSpy = vi.fn().mockResolvedValue(undefined);
    const setSuspendedSpy = vi.fn().mockResolvedValue(undefined);
    const deleteUserSpy = vi.fn().mockResolvedValue(undefined);
    const usersSignal = signal<AdminUser[]>(overrides.users ?? []);

    TestBed.configureTestingModule({
      imports: [AdminComponent],
      providers: [
        {
          provide: AdminUsersService,
          useValue: {
            users: usersSignal,
            loadUsers: loadUsersSpy,
            updateRole: updateRoleSpy,
            setSuspended: setSuspendedSpy,
            deleteUser: deleteUserSpy,
          },
        },
        {
          provide: CampgroundAttributesService,
          useValue: { attributes: signal([]), loadForCampground: vi.fn(), addAttribute: vi.fn(), updateAttribute: vi.fn(), deleteAttribute: vi.fn() },
        },
        { provide: CampgroundsService, useValue: { searchByName: vi.fn().mockResolvedValue([]) } },
      ],
    });

    const fixture = TestBed.createComponent(AdminComponent);
    return {
      component: fixture.componentInstance,
      loadUsersSpy,
      updateRoleSpy,
      setSuspendedSpy,
      deleteUserSpy,
    };
  }

  const user: AdminUser = {
    id: 'user-1', email: 'alex@example.com', displayName: 'Alex', role: 'user', suspended: false, createdAt: '2026-08-01T00:00:00Z',
  };

  it('loads users on init', async () => {
    const { component, loadUsersSpy } = setup();

    await component.ngOnInit();

    expect(loadUsersSpy).toHaveBeenCalled();
  });

  it('shows an error if loading users fails', async () => {
    const { component, loadUsersSpy } = setup();
    loadUsersSpy.mockRejectedValue(new Error('boom'));

    await component.ngOnInit();

    expect(component.usersError()).toBe('boom');
  });

  it('changes a role', async () => {
    const { component, updateRoleSpy } = setup({ users: [user] });

    await component.onRoleChange('user-1', 'moderator');

    expect(updateRoleSpy).toHaveBeenCalledWith('user-1', 'moderator');
    expect(component.usersError()).toBeNull();
  });

  it('shows an error if a role change fails', async () => {
    const { component, updateRoleSpy } = setup({ users: [user] });
    updateRoleSpy.mockRejectedValue(new Error('cannot modify your own role'));

    await component.onRoleChange('user-1', 'admin');

    expect(component.usersError()).toBe('cannot modify your own role');
  });

  it('toggles suspension', async () => {
    const { component, setSuspendedSpy } = setup({ users: [user] });

    await component.onToggleSuspended(user);

    expect(setSuspendedSpy).toHaveBeenCalledWith('user-1', true);
  });

  it('requires confirmation before deleting a user', async () => {
    const { component, deleteUserSpy } = setup({ users: [user] });

    component.onDeleteUser('user-1');
    expect(component.confirmingDeleteUserId()).toBe('user-1');
    expect(deleteUserSpy).not.toHaveBeenCalled();

    await component.onConfirmDeleteUser('user-1');
    expect(deleteUserSpy).toHaveBeenCalledWith('user-1');
    expect(component.confirmingDeleteUserId()).toBeNull();
  });

  it('shows an error and stays confirmable when delete fails', async () => {
    const { component, deleteUserSpy } = setup({ users: [user] });
    deleteUserSpy.mockRejectedValue(new Error('boom'));
    component.onDeleteUser('user-1');

    await component.onConfirmDeleteUser('user-1');

    expect(component.usersError()).toBe('boom');
    expect(component.confirmingDeleteUserId()).toBe('user-1');
  });

  it('cancels a pending delete confirmation', () => {
    const { component } = setup({ users: [user] });
    component.onDeleteUser('user-1');

    component.onCancelDeleteUser();

    expect(component.confirmingDeleteUserId()).toBeNull();
  });
});
