import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ActivatedRoute } from '@angular/router';
import { SignupComponent } from './signup.component';
import { SupabaseService } from '../../core/services/supabase.service';

describe('SignupComponent', () => {
  let component: SignupComponent;
  let signUpSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    signUpSpy = vi.fn();

    TestBed.configureTestingModule({
      imports: [SignupComponent],
      providers: [
        { provide: SupabaseService, useValue: { client: { auth: { signUp: signUpSpy } } } },
        { provide: ActivatedRoute, useValue: {} },
      ],
    });

    component = TestBed.createComponent(SignupComponent).componentInstance;
  });

  it('marks the form submitted on success', async () => {
    signUpSpy.mockResolvedValue({ error: null });
    component.email = 'a@b.com';
    component.password = 'secret';
    component.displayName = 'Shawn';

    await component.onSubmit();

    expect(signUpSpy).toHaveBeenCalledWith({
      email: 'a@b.com',
      password: 'secret',
      options: { data: { display_name: 'Shawn' } },
    });
    expect(component.submitted()).toBe(true);
  });

  it('sets an error message on failed sign-up', async () => {
    signUpSpy.mockResolvedValue({ error: { message: 'Email already registered' } });

    await component.onSubmit();

    expect(component.error()).toBe('Email already registered');
    expect(component.submitted()).toBe(false);
  });
});
