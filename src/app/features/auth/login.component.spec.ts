import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { Router, ActivatedRoute } from '@angular/router';
import { LoginComponent } from './login.component';
import { SupabaseService } from '../../core/services/supabase.service';

function createUsersQueryBuilderMock(result: { data?: any; error?: any }) {
  const builder: any = {};
  ['select', 'eq'].forEach((method) => {
    builder[method] = vi.fn().mockReturnValue(builder);
  });
  builder.single = vi.fn().mockResolvedValue(result);
  return builder;
}

describe('LoginComponent', () => {
  let component: LoginComponent;
  let signInSpy: ReturnType<typeof vi.fn>;
  let signOutSpy: ReturnType<typeof vi.fn>;
  let fromSpy: ReturnType<typeof vi.fn>;
  let navigateSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    signInSpy = vi.fn();
    signOutSpy = vi.fn().mockResolvedValue({ error: null });
    fromSpy = vi.fn();
    navigateSpy = vi.fn();

    TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        {
          provide: SupabaseService,
          useValue: { client: { auth: { signInWithPassword: signInSpy, signOut: signOutSpy }, from: fromSpy } },
        },
        { provide: Router, useValue: { navigateByUrl: navigateSpy } },
        { provide: ActivatedRoute, useValue: {} },
      ],
    });

    component = TestBed.createComponent(LoginComponent).componentInstance;
  });

  it('navigates home on successful sign-in when not suspended', async () => {
    signInSpy.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    fromSpy.mockReturnValue(createUsersQueryBuilderMock({ data: { suspended: false }, error: null }));
    component.email = 'a@b.com';
    component.password = 'secret';

    await component.onSubmit();

    expect(navigateSpy).toHaveBeenCalledWith('/');
    expect(component.error()).toBeNull();
    expect(signOutSpy).not.toHaveBeenCalled();
  });

  it('sets an error message on failed sign-in', async () => {
    signInSpy.mockResolvedValue({ data: { user: null }, error: { message: 'Invalid credentials' } });

    await component.onSubmit();

    expect(component.error()).toBe('Invalid credentials');
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('signs out and shows a suspended message instead of navigating in', async () => {
    signInSpy.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    fromSpy.mockReturnValue(createUsersQueryBuilderMock({ data: { suspended: true }, error: null }));

    await component.onSubmit();

    expect(signOutSpy).toHaveBeenCalled();
    expect(navigateSpy).not.toHaveBeenCalled();
    expect(component.error()).toBe('This account has been suspended.');
  });

  it('signs out and shows an error if the suspension-check query fails', async () => {
    signInSpy.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    fromSpy.mockReturnValue(createUsersQueryBuilderMock({ data: null, error: { message: 'Query failed' } }));

    await component.onSubmit();

    expect(signOutSpy).toHaveBeenCalled();
    expect(navigateSpy).not.toHaveBeenCalled();
    expect(component.error()).toBe('Query failed');
  });
});
