import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { CampgroundMapComponent } from '../finder/campground-map/campground-map.component';
import { CampgroundTableComponent } from '../finder/campground-table/campground-table.component';
import { FavoritesService } from '../../core/services/favorites.service';
import { CampgroundsService } from '../../core/services/campgrounds.service';
import { TripsService } from '../../core/services/trips.service';
import { Campground } from '../../core/models/campground.model';

@Component({
  selector: 'app-favorites',
  standalone: true,
  imports: [CampgroundMapComponent, CampgroundTableComponent, FormsModule, ButtonModule, InputTextModule, MessageModule],
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
  // Two error signals rather than one: the note error belongs next to the
  // table (where the failed edit is), and the trip error belongs inside the
  // "Plan a trip" panel — which is often closed when a note save fails, so a
  // shared signal would hide the message.
  readonly noteError = signal<string | null>(null);
  readonly tripError = signal<string | null>(null);
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

  async onNoteChange(event: { campgroundId: string; note: string }): Promise<void> {
    this.noteError.set(null);
    try {
      await this.favorites.updateNote(event.campgroundId, event.note);
    } catch {
      this.noteError.set("Couldn't save that note — try again.");
    }
  }

  togglePlanning(): void {
    this.planningTrip.update((v) => !v);
    this.selectedForTrip.set(new Set());
    this.tripName = '';
    this.tripError.set(null);
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
    this.tripError.set(null);
    let tripId: string;
    try {
      tripId = await this.trips.createTrip(this.tripName.trim(), Array.from(this.selectedForTrip()));
    } catch {
      this.tripError.set("Couldn't save this trip — try again.");
      return;
    }
    this.router.navigateByUrl(`/trips/${tripId}`);
  }
}
