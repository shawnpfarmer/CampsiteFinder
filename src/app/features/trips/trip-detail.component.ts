import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TableModule } from 'primeng/table';
import type { TableRowReorderEvent } from 'primeng/types/table';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { CampgroundMapComponent } from '../finder/campground-map/campground-map.component';
import { TripsService } from '../../core/services/trips.service';
import { FavoritesService } from '../../core/services/favorites.service';
import { CampgroundsService } from '../../core/services/campgrounds.service';
import { Trip, TripStop } from '../../core/models/trip.model';
import { Campground } from '../../core/models/campground.model';

@Component({
  selector: 'app-trip-detail',
  standalone: true,
  imports: [TableModule, ButtonModule, InputTextModule, FormsModule, CampgroundMapComponent],
  templateUrl: './trip-detail.component.html',
})
export class TripDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly tripsService = inject(TripsService);
  private readonly favorites = inject(FavoritesService);
  private readonly campgroundsService = inject(CampgroundsService);

  private tripId = '';

  readonly trip = signal<Trip | null>(null);
  readonly stops = signal<TripStop[]>([]);
  readonly notFound = signal(false);
  readonly editingName = signal(false);
  readonly favoriteCampgrounds = signal<Campground[]>([]);

  readonly stopCampgrounds = computed(() => this.stops().map((s) => s.campground));
  readonly availableToAdd = computed(() => {
    const inTrip = new Set(this.stops().map((s) => s.campground.id));
    return this.favoriteCampgrounds().filter((c) => !inTrip.has(c.id));
  });

  nameDraft = '';
  addStopCampgroundId = '';

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.notFound.set(true);
      return;
    }
    this.tripId = id;

    try {
      const [trip, stops] = await Promise.all([
        this.tripsService.getTrip(id),
        this.tripsService.getTripStops(id),
      ]);
      if (!trip) {
        this.notFound.set(true);
        return;
      }
      this.trip.set(trip);
      this.stops.set(stops);
    } catch {
      this.notFound.set(true);
      return;
    }

    await this.favorites.loadFavoriteIds();
    const favIds = Array.from(this.favorites.favoriteIds());
    this.favoriteCampgrounds.set(favIds.length > 0 ? await this.campgroundsService.getByIds(favIds) : []);
  }

  startRename(): void {
    this.nameDraft = this.trip()?.name ?? '';
    this.editingName.set(true);
  }

  async saveRename(): Promise<void> {
    const name = this.nameDraft.trim();
    if (!name) return;
    await this.tripsService.renameTrip(this.tripId, name);
    this.trip.update((t) => (t ? { ...t, name } : t));
    this.editingName.set(false);
  }

  async onDeleteTrip(): Promise<void> {
    if (!window.confirm('Delete this trip? This cannot be undone.')) return;
    await this.tripsService.deleteTrip(this.tripId);
    this.router.navigateByUrl('/trips');
  }

  async onAddStop(): Promise<void> {
    if (!this.addStopCampgroundId) return;
    await this.tripsService.addStop(this.tripId, this.addStopCampgroundId);
    this.addStopCampgroundId = '';
    this.stops.set(await this.tripsService.getTripStops(this.tripId));
  }

  async onRemoveStop(stopId: string): Promise<void> {
    await this.tripsService.removeStop(this.tripId, stopId);
    this.stops.update((stops) => stops.filter((s) => s.stopId !== stopId));
  }

  async onRowReorder(event: TableRowReorderEvent): Promise<void> {
    if (event.dragIndex == null || event.dropIndex == null) {
      return;
    }
    const reordered = [...this.stops()];
    const [moved] = reordered.splice(event.dragIndex, 1);
    reordered.splice(event.dropIndex, 0, moved);
    this.stops.set(reordered);

    await this.tripsService.reorderStops(
      this.tripId,
      reordered.map((s) => s.stopId),
    );
  }
}
