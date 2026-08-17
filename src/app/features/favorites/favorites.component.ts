import { Component, OnInit, inject, signal } from '@angular/core';
import { CampgroundMapComponent } from '../finder/campground-map/campground-map.component';
import { CampgroundTableComponent } from '../finder/campground-table/campground-table.component';
import { FavoritesService } from '../../core/services/favorites.service';
import { CampgroundsService } from '../../core/services/campgrounds.service';
import { Campground } from '../../core/models/campground.model';

@Component({
  selector: 'app-favorites',
  standalone: true,
  imports: [CampgroundMapComponent, CampgroundTableComponent],
  templateUrl: './favorites.component.html',
})
export class FavoritesComponent implements OnInit {
  private readonly favorites = inject(FavoritesService);
  private readonly campgroundsService = inject(CampgroundsService);

  readonly campgrounds = signal<Campground[]>([]);
  readonly selected = signal<Campground | null>(null);

  async ngOnInit(): Promise<void> {
    await this.favorites.loadFavoriteIds();
    const ids = Array.from(this.favorites.favoriteIds());
    if (ids.length === 0) {
      this.campgrounds.set([]);
      return;
    }
    const results = await this.campgroundsService.getByIds(ids);
    this.campgrounds.set(results);
  }

  onSelectionChange(campground: Campground | null): void {
    this.selected.set(campground);
  }
}
