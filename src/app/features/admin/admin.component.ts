import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { TabsModule } from 'primeng/tabs';
import { SelectModule } from 'primeng/select';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { AdminUsersService } from '../../core/services/admin-users.service';
import { AdminUser } from '../../core/models/admin-user.model';

const ROLE_OPTIONS: { label: string; value: 'user' | 'moderator' | 'admin' }[] = [
  { label: 'User', value: 'user' },
  { label: 'Moderator', value: 'moderator' },
  { label: 'Admin', value: 'admin' },
];

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [DatePipe, FormsModule, TableModule, TabsModule, SelectModule, ButtonModule, MessageModule],
  templateUrl: './admin.component.html',
})
export class AdminComponent implements OnInit {
  private readonly adminUsersService = inject(AdminUsersService);

  readonly roleOptions = ROLE_OPTIONS;
  readonly users = this.adminUsersService.users;
  readonly usersError = signal<string | null>(null);
  readonly confirmingDeleteUserId = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    try {
      await this.adminUsersService.loadUsers();
    } catch (err) {
      this.usersError.set(err instanceof Error ? err.message : 'Could not load users.');
    }
  }

  async onRoleChange(userId: string, role: 'user' | 'moderator' | 'admin'): Promise<void> {
    this.usersError.set(null);
    try {
      await this.adminUsersService.updateRole(userId, role);
    } catch (err) {
      this.usersError.set(err instanceof Error ? err.message : 'Could not update role.');
    }
  }

  async onToggleSuspended(user: AdminUser): Promise<void> {
    this.usersError.set(null);
    try {
      await this.adminUsersService.setSuspended(user.id, !user.suspended);
    } catch (err) {
      this.usersError.set(err instanceof Error ? err.message : 'Could not update suspension.');
    }
  }

  onDeleteUser(userId: string): void {
    this.confirmingDeleteUserId.set(userId);
  }

  onCancelDeleteUser(): void {
    this.confirmingDeleteUserId.set(null);
  }

  async onConfirmDeleteUser(userId: string): Promise<void> {
    this.usersError.set(null);
    try {
      await this.adminUsersService.deleteUser(userId);
      this.confirmingDeleteUserId.set(null);
    } catch (err) {
      this.usersError.set(err instanceof Error ? err.message : 'Could not delete user.');
    }
  }
}
