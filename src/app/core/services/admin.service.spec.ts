import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { AdminService } from './admin.service';
import { SupabaseService } from './supabase.service';

function createQueryBuilderMock(result: { data?: any; error?: any }) {
  const builder: any = {};
  ['select', 'order'].forEach((method) => {
    builder[method] = vi.fn().mockReturnValue(builder);
  });
  builder.then = (resolve: any) => resolve(result);
  return builder;
}

describe('AdminService', () => {
  let service: AdminService;
  let fromSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fromSpy = vi.fn();
    TestBed.configureTestingModule({
      providers: [{ provide: SupabaseService, useValue: { client: { from: fromSpy } } }],
    });
    service = TestBed.inject(AdminService);
  });

  it('lists users ordered by display name', async () => {
    fromSpy.mockReturnValue(
      createQueryBuilderMock({
        data: [
          { id: 'user-1', display_name: 'Alex', role: 'user' },
          { id: 'user-2', display_name: 'Sam', role: 'admin' },
        ],
        error: null,
      }),
    );

    const users = await service.listUsers();

    expect(fromSpy).toHaveBeenCalledWith('users');
    expect(users).toEqual([
      { id: 'user-1', displayName: 'Alex', role: 'user' },
      { id: 'user-2', displayName: 'Sam', role: 'admin' },
    ]);
  });

  it('throws when the query errors', async () => {
    fromSpy.mockReturnValue(createQueryBuilderMock({ data: null, error: new Error('boom') }));

    await expect(service.listUsers()).rejects.toThrow('boom');
  });
});
