import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { SupabaseService } from '../../core/services/supabase.service';

@Component({
  selector: 'app-signup',
  standalone: true,
  imports: [FormsModule, ButtonModule, InputTextModule, MessageModule, RouterLink],
  templateUrl: './signup.component.html',
})
export class SignupComponent {
  email = '';
  password = '';
  displayName = '';
  readonly error = signal<string | null>(null);
  readonly submitted = signal(false);

  constructor(private readonly supabase: SupabaseService) {}

  async onSubmit(): Promise<void> {
    this.error.set(null);
    const { error } = await this.supabase.client.auth.signUp({
      email: this.email,
      password: this.password,
      options: { data: { display_name: this.displayName } },
    });
    if (error) {
      this.error.set(error.message);
      return;
    }
    this.submitted.set(true);
  }
}
