import { Component, effect, inject } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { SupabaseService } from './core/services/supabase.service';
import { UserService } from './core/services/user.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, ButtonModule],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  readonly supabase = inject(SupabaseService);
  private readonly userService = inject(UserService);

  constructor() {
    effect(() => {
      if (this.supabase.session()) {
        this.userService.loadProfile();
      }
    });
  }

  onSignOut(): void {
    this.supabase.client.auth.signOut();
  }
}
