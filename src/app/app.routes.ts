import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./features/finder/finder.component').then((m) => m.FinderComponent),
  },
  {
    path: 'favorites',
    loadComponent: () => import('./features/favorites/favorites.component').then((m) => m.FavoritesComponent),
    canActivate: [authGuard],
  },
  {
    path: 'login',
    loadComponent: () => import('./features/auth/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'signup',
    loadComponent: () => import('./features/auth/signup.component').then((m) => m.SignupComponent),
  },
  {
    path: 'campground/:id',
    loadComponent: () =>
      import('./features/campground-detail/campground-detail.component').then(
        (m) => m.CampgroundDetailComponent,
      ),
  },
];
