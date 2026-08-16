import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./features/finder/finder.component').then((m) => m.FinderComponent),
  },
];
