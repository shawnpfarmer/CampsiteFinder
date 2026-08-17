import { Component, Input, OnInit, inject } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { FavoritesService } from '../../core/services/favorites.service';
import { SupabaseService } from '../../core/services/supabase.service';

@Component({
  selector: 'app-favorite-toggle',
  standalone: true,
  imports: [ButtonModule],
  template: `
    @if (supabase.isAuthenticated) {
      <button pButton [text]="true" (click)="onToggle()">
        <i [class]="favorites.favoriteIds().has(campgroundId) ? 'pi pi-heart-fill' : 'pi pi-heart'"></i>
      </button>
    }
  `,
})
export class FavoriteToggleComponent implements OnInit {
  @Input({ required: true }) campgroundId!: string;

  readonly favorites = inject(FavoritesService);
  readonly supabase = inject(SupabaseService);

  ngOnInit(): void {
    if (this.favorites.favoriteIds().size === 0) {
      this.favorites.loadFavoriteIds();
    }
  }

  onToggle(): void {
    this.favorites.toggleFavorite(this.campgroundId);
  }
}
