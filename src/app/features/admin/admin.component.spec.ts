import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { AdminComponent } from './admin.component';
import { AdminService } from '../../core/services/admin.service';

describe('AdminComponent', () => {
  it('loads users on init', async () => {
    const listUsersSpy = vi.fn().mockResolvedValue([{ id: 'user-1', displayName: 'Alex', role: 'admin' }]);
    TestBed.configureTestingModule({
      imports: [AdminComponent],
      providers: [{ provide: AdminService, useValue: { listUsers: listUsersSpy } }],
    });

    const component = TestBed.createComponent(AdminComponent).componentInstance;
    await component.ngOnInit();

    expect(listUsersSpy).toHaveBeenCalled();
    expect(component.users()).toEqual([{ id: 'user-1', displayName: 'Alex', role: 'admin' }]);
  });
});
