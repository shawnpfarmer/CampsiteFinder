import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { AdminComponent } from './admin.component';
import { AdminUsersService } from '../../core/services/admin-users.service';
import { CampgroundAttributesService } from '../../core/services/campground-attributes.service';
import { CampgroundsService } from '../../core/services/campgrounds.service';
import { AdminUser } from '../../core/models/admin-user.model';
import { CampgroundAttribute } from '../../core/models/campground-attribute.model';
import { signal } from '@angular/core';

describe('AdminComponent', () => {
  function setup(overrides: { users?: AdminUser[]; attributes?: CampgroundAttribute[] } = {}) {
    const loadUsersSpy = vi.fn().mockResolvedValue(undefined);
    const updateRoleSpy = vi.fn().mockResolvedValue(undefined);
    const setSuspendedSpy = vi.fn().mockResolvedValue(undefined);
    const deleteUserSpy = vi.fn().mockResolvedValue(undefined);
    const usersSignal = signal<AdminUser[]>(overrides.users ?? []);
    const loadForCampgroundSpy = vi.fn().mockResolvedValue(undefined);
    const addAttributeSpy = vi.fn().mockResolvedValue(undefined);
    const updateAttributeSpy = vi.fn().mockResolvedValue(undefined);
    const deleteAttributeSpy = vi.fn().mockResolvedValue(undefined);
    const searchByNameSpy = vi.fn().mockResolvedValue([{ id: 'cg-1', name: 'Blackwoods Campground' }]);

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
          useValue: {
            attributes: signal(overrides.attributes ?? []),
            loadForCampground: loadForCampgroundSpy,
            addAttribute: addAttributeSpy,
            updateAttribute: updateAttributeSpy,
            deleteAttribute: deleteAttributeSpy,
          },
        },
        { provide: CampgroundsService, useValue: { searchByName: searchByNameSpy } },
      ],
    });

    const fixture = TestBed.createComponent(AdminComponent);
    return {
      component: fixture.componentInstance,
      loadUsersSpy,
      updateRoleSpy,
      setSuspendedSpy,
      deleteUserSpy,
      loadForCampgroundSpy,
      addAttributeSpy,
      updateAttributeSpy,
      deleteAttributeSpy,
      searchByNameSpy,
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

  it('reloads users from the server when a role change fails, so the dropdown reflects true state', async () => {
    const { component, updateRoleSpy, loadUsersSpy } = setup({ users: [user] });
    updateRoleSpy.mockRejectedValue(new Error('cannot modify your own role'));

    await component.onRoleChange('user-1', 'admin');

    expect(loadUsersSpy).toHaveBeenCalled();
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

  const attribute: CampgroundAttribute = {
    id: 'attr-1', campgroundId: 'cg-1', type: 'accessibility', name: 'Wheelchair accessible', value: 'yes', createdAt: '2026-08-01T00:00:00Z',
  };

  it('searches campgrounds by name', async () => {
    const { component, searchByNameSpy } = setup();

    await component.onSearchCampgrounds({ originalEvent: new Event('input'), query: 'black' } as any);

    expect(searchByNameSpy).toHaveBeenCalledWith('black');
    expect(component.campgroundSuggestions()).toEqual([{ id: 'cg-1', name: 'Blackwoods Campground' }]);
  });

  it('shows an error if searching campgrounds fails', async () => {
    const { component, searchByNameSpy } = setup();
    searchByNameSpy.mockRejectedValue(new Error('boom'));

    await component.onSearchCampgrounds({ originalEvent: new Event('input'), query: 'black' } as any);

    expect(component.attributesError()).toBe('boom');
  });

  it('loads attributes when a campground is selected', async () => {
    const { component, loadForCampgroundSpy } = setup();

    await component.onSelectCampground({ originalEvent: new Event('click'), value: { id: 'cg-1', name: 'Blackwoods Campground' } } as any);

    expect(component.selectedCampground).toEqual({ id: 'cg-1', name: 'Blackwoods Campground' });
    expect(loadForCampgroundSpy).toHaveBeenCalledWith('cg-1');
  });

  it('adds an attribute for the selected campground and clears the form', async () => {
    const { component, addAttributeSpy } = setup();
    component.selectedCampground = { id: 'cg-1', name: 'Blackwoods Campground' };
    component.newAttributeType = 'fee';
    component.newAttributeName = 'Reservation fee';
    component.newAttributeValue = '10';

    await component.onAddAttribute();

    expect(addAttributeSpy).toHaveBeenCalledWith('cg-1', 'fee', 'Reservation fee', '10');
    expect(component.newAttributeType).toBe('');
    expect(component.newAttributeName).toBe('');
    expect(component.newAttributeValue).toBe('');
  });

  it('does not add an attribute when no campground is selected', async () => {
    const { component, addAttributeSpy } = setup();
    component.newAttributeType = 'fee';
    component.newAttributeName = 'Reservation fee';

    await component.onAddAttribute();

    expect(addAttributeSpy).not.toHaveBeenCalled();
  });

  it('starts and saves an attribute edit', async () => {
    const { component, updateAttributeSpy } = setup({ attributes: [attribute] });

    component.onStartEditAttribute(attribute);
    expect(component.editingAttributeId()).toBe('attr-1');
    expect(component.editAttributeType).toBe('accessibility');

    component.editAttributeValue = 'no';
    await component.onSaveEditAttribute('attr-1');

    expect(updateAttributeSpy).toHaveBeenCalledWith('attr-1', 'accessibility', 'Wheelchair accessible', 'no');
    expect(component.editingAttributeId()).toBeNull();
  });

  it('cancels an attribute edit', () => {
    const { component } = setup({ attributes: [attribute] });
    component.onStartEditAttribute(attribute);

    component.onCancelEditAttribute();

    expect(component.editingAttributeId()).toBeNull();
  });

  it('deletes an attribute', async () => {
    const { component, deleteAttributeSpy } = setup({ attributes: [attribute] });

    await component.onDeleteAttribute('attr-1');

    expect(deleteAttributeSpy).toHaveBeenCalledWith('attr-1');
  });

  it('shows an error if adding an attribute fails', async () => {
    const { component, addAttributeSpy } = setup();
    addAttributeSpy.mockRejectedValue(new Error('boom'));
    component.selectedCampground = { id: 'cg-1', name: 'Blackwoods Campground' };
    component.newAttributeType = 'fee';
    component.newAttributeName = 'Reservation fee';

    await component.onAddAttribute();

    expect(component.attributesError()).toBe('boom');
  });
});
