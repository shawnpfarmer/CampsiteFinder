import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SupabaseService } from '../services/supabase.service';
import { UserService } from '../services/user.service';

export const adminGuard: CanActivateFn = async () => {
  const supabase = inject(SupabaseService);
  const userService = inject(UserService);
  const router = inject(Router);

  if (!supabase.isAuthenticated) {
    return router.parseUrl('/login');
  }
  if (!userService.profile()) {
    await userService.loadProfile();
  }
  if (userService.profile()?.role === 'admin') {
    return true;
  }
  return router.parseUrl('/');
};
