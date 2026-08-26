import { Component, OnInit, inject, signal } from '@angular/core';
import { TableModule } from 'primeng/table';
import { AdminService } from '../../core/services/admin.service';
import { AdminUserSummary } from '../../core/models/user.model';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [TableModule],
  templateUrl: './admin.component.html',
})
export class AdminComponent implements OnInit {
  private readonly adminService = inject(AdminService);

  readonly users = signal<AdminUserSummary[]>([]);

  async ngOnInit(): Promise<void> {
    this.users.set(await this.adminService.listUsers());
  }
}
