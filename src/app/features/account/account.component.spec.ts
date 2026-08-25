import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { provideRouter } from '@angular/router';
import { AccountComponent } from './account.component';
import { UserService } from '../../core/services/user.service';

describe('AccountComponent', () => {
  function setup(overrides: Partial<Record<keyof UserService, unknown>> = {}) {
    const userService = {
      profile: () => ({ id: 'user-1', displayName: 'Alex', theme: 'light', role: 'user' }),
      loadProfile: vi.fn().mockResolvedValue(undefined),
      updateDisplayName: vi.fn().mockResolvedValue(undefined),
      updatePassword: vi.fn().mockResolvedValue(undefined),
      updateTheme: vi.fn().mockResolvedValue(undefined),
      deleteAccount: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    };
    TestBed.configureTestingModule({
      imports: [AccountComponent],
      providers: [provideRouter([]), { provide: UserService, useValue: userService }],
    });
    const fixture = TestBed.createComponent(AccountComponent);
    return { fixture, component: fixture.componentInstance, userService };
  }

  it('loads the profile and seeds the display name field on init', async () => {
    const { component } = setup();

    await component.ngOnInit();

    expect(component.displayName).toBe('Alex');
    expect(component.isDarkTheme()).toBe(false);
  });

  it('saves the display name', async () => {
    const { component, userService } = setup();
    await component.ngOnInit();
    component.displayName = 'New Name';

    await component.onSaveDisplayName();

    expect(userService.updateDisplayName).toHaveBeenCalledWith('New Name');
    expect(component.displayNameNotice()).toBe('Display name updated.');
  });

  it('shows an error when saving the display name fails', async () => {
    const { component } = setup({ updateDisplayName: vi.fn().mockRejectedValue(new Error('boom')) });
    await component.ngOnInit();

    await component.onSaveDisplayName();

    expect(component.displayNameError()).toBe('Could not update display name. Please try again.');
  });

  it('rejects a password save when the confirmation does not match', async () => {
    const { component, userService } = setup();
    component.newPassword = 'abc123';
    component.confirmPassword = 'different';

    await component.onSavePassword();

    expect(userService.updatePassword).not.toHaveBeenCalled();
    expect(component.passwordError()).toBe('Passwords do not match.');
  });

  it('saves the password when confirmation matches', async () => {
    const { component, userService } = setup();
    component.newPassword = 'abc123';
    component.confirmPassword = 'abc123';

    await component.onSavePassword();

    expect(userService.updatePassword).toHaveBeenCalledWith('abc123');
    expect(component.passwordNotice()).toBe('Password updated.');
  });

  it('shows the underlying error message when saving the password fails', async () => {
    const { component } = setup({
      updatePassword: vi.fn().mockRejectedValue(new Error('Password should be at least 6 characters')),
    });
    component.newPassword = 'abc123';
    component.confirmPassword = 'abc123';

    await component.onSavePassword();

    expect(component.passwordError()).toBe('Password should be at least 6 characters');
  });

  it('falls back to a generic message when the password failure has no message', async () => {
    const { component } = setup({ updatePassword: vi.fn().mockRejectedValue('boom') });
    component.newPassword = 'abc123';
    component.confirmPassword = 'abc123';

    await component.onSavePassword();

    expect(component.passwordError()).toBe('Could not update password. Please try again.');
  });

  it('toggles theme and reverts on failure', async () => {
    const { component } = setup({ updateTheme: vi.fn().mockRejectedValue(new Error('boom')) });
    await component.ngOnInit();

    await component.onThemeToggle(true);

    expect(component.isDarkTheme()).toBe(false);
    expect(component.themeError()).toBe('Could not update theme. Please try again.');
  });

  it('requires confirmation before deleting the account', async () => {
    const { component, userService } = setup();

    component.onDeleteAccount();
    expect(component.confirmingDelete()).toBe(true);
    expect(userService.deleteAccount).not.toHaveBeenCalled();

    await component.onConfirmDelete();
    expect(userService.deleteAccount).toHaveBeenCalled();
  });

  it('shows an error and stays confirmable when delete fails', async () => {
    const { component } = setup({ deleteAccount: vi.fn().mockRejectedValue(new Error('boom')) });
    component.onDeleteAccount();

    await component.onConfirmDelete();

    expect(component.deleteError()).toBe('Could not delete account. Please try again.');
  });
});
