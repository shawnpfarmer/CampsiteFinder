import { Component, Input, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { Popover, PopoverModule } from 'primeng/popover';
import { TripsService } from '../../core/services/trips.service';
import { SupabaseService } from '../../core/services/supabase.service';

@Component({
  selector: 'app-add-to-trip',
  standalone: true,
  imports: [ButtonModule, InputTextModule, MessageModule, PopoverModule, FormsModule],
  template: `
    @if (supabase.isAuthenticated) {
      <button pButton [text]="true" (click)="op.toggle($event)">Add to Trip</button>
      <p-popover #op (onShow)="onShow()">
        <ng-template #content>
          <div class="add-to-trip-panel">
            @for (trip of trips.trips(); track trip.id) {
              <button
                pButton
                [text]="true"
                [disabled]="tripsContaining().has(trip.id)"
                (click)="onAdd(trip.id, op)"
              >
                {{ trip.name }}{{ tripsContaining().has(trip.id) ? ' (added)' : '' }}
              </button>
            }
            <div class="add-to-trip-new">
              <input pInputText type="text" placeholder="New trip name" [(ngModel)]="newTripName" />
              <button pButton (click)="onCreateAndAdd(op)">Create &amp; Add</button>
            </div>
            @if (error()) {
              <p-message severity="warn">{{ error() }}</p-message>
            }
          </div>
        </ng-template>
      </p-popover>
    }
  `,
})
export class AddToTripComponent {
  @Input({ required: true }) campgroundId!: string;

  readonly trips = inject(TripsService);
  readonly supabase = inject(SupabaseService);

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly tripsContaining = signal<Set<string>>(new Set());
  newTripName = '';

  async onShow(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [, containing] = await Promise.all([
        this.trips.loadTrips(),
        this.trips.getTripIdsForCampground(this.campgroundId),
      ]);
      this.tripsContaining.set(containing);
    } catch {
      this.error.set("Couldn't load trips — try again.");
    } finally {
      this.loading.set(false);
    }
  }

  async onAdd(tripId: string, popover: Popover): Promise<void> {
    this.error.set(null);
    try {
      await this.trips.addStop(tripId, this.campgroundId);
      this.tripsContaining.update((ids) => new Set(ids).add(tripId));
      popover.hide();
    } catch {
      this.error.set("Couldn't add to that trip — try again.");
    }
  }

  async onCreateAndAdd(popover: Popover): Promise<void> {
    const name = this.newTripName.trim();
    if (!name) return;
    this.error.set(null);
    try {
      await this.trips.createTrip(name, [this.campgroundId]);
      this.newTripName = '';
      popover.hide();
    } catch {
      this.error.set("Couldn't create that trip — try again.");
    }
  }
}
