import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TableModule } from 'primeng/table';
import type { TableRowReorderEvent } from 'primeng/types/table';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { CampgroundMapComponent } from '../finder/campground-map/campground-map.component';
import { CampgroundDetailPanelComponent } from '../finder/campground-table/campground-detail-panel/campground-detail-panel.component';
import { TripsService } from '../../core/services/trips.service';
import { FavoritesService } from '../../core/services/favorites.service';
import { CampgroundsService } from '../../core/services/campgrounds.service';
import { Trip, TripStop } from '../../core/models/trip.model';
import { Campground } from '../../core/models/campground.model';

@Component({
  selector: 'app-trip-detail',
  standalone: true,
  imports: [
    TableModule,
    ButtonModule,
    InputTextModule,
    MessageModule,
    FormsModule,
    CampgroundMapComponent,
    CampgroundDetailPanelComponent,
  ],
  templateUrl: './trip-detail.component.html',
  styles: `
    .campground-name-link {
      cursor: pointer;
    }
  `,
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
  readonly error = signal<string | null>(null);
  readonly editingName = signal(false);
  readonly favoriteCampgrounds = signal<Campground[]>([]);

  readonly stopCampgrounds = computed(() => this.stops().map((s) => s.campground));
  readonly availableToAdd = computed(() => {
    const inTrip = new Set(this.stops().map((s) => s.campground.id));
    return this.favoriteCampgrounds().filter((c) => !inTrip.has(c.id));
  });

  nameDraft = '';
  addStopCampgroundId = '';
  expandedStopId: string | null = null;

  toggleExpanded(stopId: string): void {
    this.expandedStopId = this.expandedStopId === stopId ? null : stopId;
  }

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

    try {
      await this.favorites.loadFavoriteIds();
      const favIds = Array.from(this.favorites.favoriteIds());
      this.favoriteCampgrounds.set(favIds.length > 0 ? await this.campgroundsService.getByIds(favIds) : []);
    } catch {
      this.favoriteCampgrounds.set([]);
    }
  }

  startRename(): void {
    this.nameDraft = this.trip()?.name ?? '';
    this.editingName.set(true);
  }

  async saveRename(): Promise<void> {
    const name = this.nameDraft.trim();
    if (!name) return;
    this.error.set(null);
    try {
      await this.tripsService.renameTrip(this.tripId, name);
    } catch {
      this.error.set("Couldn't rename this trip — try again.");
      return;
    }
    this.trip.update((t) => (t ? { ...t, name } : t));
    this.editingName.set(false);
  }

  async onDeleteTrip(): Promise<void> {
    if (!window.confirm('Delete this trip? This cannot be undone.')) return;
    this.error.set(null);
    try {
      await this.tripsService.deleteTrip(this.tripId);
    } catch {
      this.error.set("Couldn't delete this trip — try again.");
      return;
    }
    this.router.navigateByUrl('/trips');
  }

  async onAddStop(): Promise<void> {
    if (!this.addStopCampgroundId) return;
    this.error.set(null);
    try {
      await this.tripsService.addStop(this.tripId, this.addStopCampgroundId);
      this.addStopCampgroundId = '';
      this.stops.set(await this.tripsService.getTripStops(this.tripId));
    } catch {
      this.error.set("Couldn't add that stop — try again.");
    }
  }

  async onRemoveStop(stopId: string): Promise<void> {
    this.error.set(null);
    try {
      await this.tripsService.removeStop(this.tripId, stopId);
    } catch {
      this.error.set("Couldn't remove that stop — try again.");
      return;
    }
    this.stops.update((stops) => stops.filter((s) => s.stopId !== stopId));
  }

  async onRowReorder(event: TableRowReorderEvent): Promise<void> {
    // PrimeNG's Table.onRowDrop already reorders the bound array in place
    // (splices the moved row into its new position) before emitting this
    // event — this.stops() already reflects the new order. Just republish
    // a fresh array reference so the signal notifies downstream consumers,
    // then persist the order that's already there.
    const reordered = [...this.stops()];
    this.stops.set(reordered);
    this.error.set(null);
    try {
      await this.tripsService.reorderStops(
        this.tripId,
        reordered.map((s) => s.stopId),
      );
    } catch {
      this.error.set("Couldn't reorder stops — try again.");
      // The on-screen order came from PrimeNG's in-place splice, so it no
      // longer matches the database (and reorderStops may have persisted
      // some positions before failing). Re-read the stops so what's shown is
      // what's stored; if that read fails too, leave the error message up.
      try {
        this.stops.set(await this.tripsService.getTripStops(this.tripId));
      } catch {
        /* keep the reorder error message */
      }
    }
  }
}
