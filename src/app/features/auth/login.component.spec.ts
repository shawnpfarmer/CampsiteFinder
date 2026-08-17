import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { Router, ActivatedRoute } from '@angular/router';
import { LoginComponent } from './login.component';
import { SupabaseService } from '../../core/services/supabase.service';

describe('LoginComponent', () => {
  let component: LoginComponent;
  let signInSpy: ReturnType<typeof vi.fn>;
  let navigateSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    signInSpy = vi.fn();
    navigateSpy = vi.fn();

    TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        { provide: SupabaseService, useValue: { client: { auth: { signInWithPassword: signInSpy } } } },
        { provide: Router, useValue: { navigateByUrl: navigateSpy } },
        { provide: ActivatedRoute, useValue: {} },
      ],
    });

    component = TestBed.createComponent(LoginComponent).componentInstance;
  });

  it('navigates home on successful sign-in', async () => {
    signInSpy.mockResolvedValue({ error: null });
    component.email = 'a@b.com';
    component.password = 'secret';

    await component.onSubmit();

    expect(navigateSpy).toHaveBeenCalledWith('/');
    expect(component.error()).toBeNull();
  });

  it('sets an error message on failed sign-in', async () => {
    signInSpy.mockResolvedValue({ error: { message: 'Invalid credentials' } });

    await component.onSubmit();

    expect(component.error()).toBe('Invalid credentials');
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});
