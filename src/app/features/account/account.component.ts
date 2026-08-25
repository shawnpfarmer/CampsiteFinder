import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { UserService } from '../../core/services/user.service';

@Component({
  selector: 'app-account',
  standalone: true,
  imports: [FormsModule, ButtonModule, InputTextModule, MessageModule, ToggleSwitchModule],
  templateUrl: './account.component.html',
})
export class AccountComponent implements OnInit {
  private readonly userService = inject(UserService);
  private readonly router = inject(Router);

  displayName = '';
  readonly displayNameNotice = signal<string | null>(null);
  readonly displayNameError = signal<string | null>(null);
  readonly savingDisplayName = signal(false);

  newPassword = '';
  confirmPassword = '';
  readonly passwordNotice = signal<string | null>(null);
  readonly passwordError = signal<string | null>(null);
  readonly savingPassword = signal(false);

  readonly isDarkTheme = signal(false);
  readonly themeError = signal<string | null>(null);

  readonly confirmingDelete = signal(false);
  readonly deleteError = signal<string | null>(null);
  readonly deletingAccount = signal(false);

  async ngOnInit(): Promise<void> {
    await this.userService.loadProfile();
    const profile = this.userService.profile();
    if (profile) {
      this.displayName = profile.displayName;
      this.isDarkTheme.set(profile.theme === 'dark');
    }
  }

  async onSaveDisplayName(): Promise<void> {
    this.displayNameNotice.set(null);
    this.displayNameError.set(null);
    this.savingDisplayName.set(true);
    try {
      await this.userService.updateDisplayName(this.displayName.trim());
      this.displayNameNotice.set('Display name updated.');
    } catch {
      this.displayNameError.set('Could not update display name. Please try again.');
    } finally {
      this.savingDisplayName.set(false);
    }
  }

  async onSavePassword(): Promise<void> {
    this.passwordNotice.set(null);
    this.passwordError.set(null);
    if (this.newPassword !== this.confirmPassword) {
      this.passwordError.set('Passwords do not match.');
      return;
    }
    this.savingPassword.set(true);
    try {
      await this.userService.updatePassword(this.newPassword);
      this.newPassword = '';
      this.confirmPassword = '';
      this.passwordNotice.set('Password updated.');
    } catch {
      this.passwordError.set('Could not update password. Please try again.');
    } finally {
      this.savingPassword.set(false);
    }
  }

  async onThemeToggle(isDark: boolean): Promise<void> {
    this.themeError.set(null);
    const previous = this.isDarkTheme();
    this.isDarkTheme.set(isDark);
    try {
      await this.userService.updateTheme(isDark ? 'dark' : 'light');
    } catch {
      this.isDarkTheme.set(previous);
      this.themeError.set('Could not update theme. Please try again.');
    }
  }

  onDeleteAccount(): void {
    this.confirmingDelete.set(true);
  }

  onCancelDelete(): void {
    this.confirmingDelete.set(false);
  }

  async onConfirmDelete(): Promise<void> {
    this.deleteError.set(null);
    this.deletingAccount.set(true);
    try {
      await this.userService.deleteAccount();
      this.router.navigateByUrl('/');
    } catch {
      this.deleteError.set('Could not delete account. Please try again.');
      this.deletingAccount.set(false);
    }
  }
}
