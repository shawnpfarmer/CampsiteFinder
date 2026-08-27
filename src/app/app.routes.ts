import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { adminGuard } from './core/guards/admin.guard';

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
    path: 'trips',
    loadComponent: () => import('./features/trips/trips-list.component').then((m) => m.TripsListComponent),
    canActivate: [authGuard],
  },
  {
    path: 'trips/:id',
    loadComponent: () => import('./features/trips/trip-detail.component').then((m) => m.TripDetailComponent),
    canActivate: [authGuard],
  },
  {
    path: 'account',
    loadComponent: () => import('./features/account/account.component').then((m) => m.AccountComponent),
    canActivate: [authGuard],
  },
  {
    path: 'admin',
    loadComponent: () => import('./features/admin/admin.component').then((m) => m.AdminComponent),
    canActivate: [adminGuard],
  },
  {
    path: 'about',
    loadComponent: () => import('./features/about/about.component').then((m) => m.AboutComponent),
  },
  {
    path: 'campground/:id',
    loadComponent: () =>
      import('./features/campground-detail/campground-detail.component').then(
        (m) => m.CampgroundDetailComponent,
      ),
  },
];
