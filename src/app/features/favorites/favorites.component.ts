import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { CampgroundMapComponent } from '../finder/campground-map/campground-map.component';
import { CampgroundTableComponent } from '../finder/campground-table/campground-table.component';
import { FavoritesService } from '../../core/services/favorites.service';
import { CampgroundsService } from '../../core/services/campgrounds.service';
import { TripsService } from '../../core/services/trips.service';
import { Campground } from '../../core/models/campground.model';

@Component({
  selector: 'app-favorites',
  standalone: true,
  imports: [CampgroundMapComponent, CampgroundTableComponent, FormsModule, ButtonModule, InputTextModule],
  templateUrl: './favorites.component.html',
})
export class FavoritesComponent implements OnInit {
  readonly favorites = inject(FavoritesService);
  private readonly campgroundsService = inject(CampgroundsService);
  private readonly trips = inject(TripsService);
  private readonly router = inject(Router);

  readonly campgrounds = signal<Campground[]>([]);
  readonly selected = signal<Campground | null>(null);
  readonly planningTrip = signal(false);
  readonly selectedForTrip = signal<Set<string>>(new Set());
  tripName = '';

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

  onNoteChange(event: { campgroundId: string; note: string }): void {
    this.favorites.updateNote(event.campgroundId, event.note);
  }

  togglePlanning(): void {
    this.planningTrip.update((v) => !v);
    this.selectedForTrip.set(new Set());
    this.tripName = '';
  }

  toggleSelectedForTrip(campgroundId: string): void {
    this.selectedForTrip.update((ids) => {
      const next = new Set(ids);
      if (next.has(campgroundId)) {
        next.delete(campgroundId);
      } else {
        next.add(campgroundId);
      }
      return next;
    });
  }

  get canSaveTrip(): boolean {
    return this.tripName.trim().length > 0 && this.selectedForTrip().size > 0;
  }

  async saveTrip(): Promise<void> {
    const tripId = await this.trips.createTrip(this.tripName.trim(), Array.from(this.selectedForTrip()));
    this.router.navigateByUrl(`/trips/${tripId}`);
  }
}
