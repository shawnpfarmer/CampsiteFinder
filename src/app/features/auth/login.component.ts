import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { SupabaseService } from '../../core/services/supabase.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, ButtonModule, InputTextModule, MessageModule, RouterLink],
  templateUrl: './login.component.html',
})
export class LoginComponent {
  email = '';
  password = '';
  readonly error = signal<string | null>(null);
  readonly submitting = signal(false);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly router: Router,
  ) {}

  async onSubmit(): Promise<void> {
    this.submitting.set(true);
    this.error.set(null);
    const { data, error } = await this.supabase.client.auth.signInWithPassword({
      email: this.email,
      password: this.password,
    });
    if (error) {
      this.submitting.set(false);
      this.error.set(error.message);
      return;
    }

    const { data: userRow, error: suspendedError } = await this.supabase.client
      .from('users')
      .select('suspended')
      .eq('id', data.user!.id)
      .single();
    this.submitting.set(false);
    if (suspendedError) {
      await this.supabase.client.auth.signOut();
      this.error.set(suspendedError.message);
      return;
    }
    if (userRow.suspended) {
      await this.supabase.client.auth.signOut();
      this.error.set('This account has been suspended.');
      return;
    }
    this.router.navigateByUrl('/');
  }
}
