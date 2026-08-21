import { Component, OnInit, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TripsService } from '../../core/services/trips.service';

@Component({
  selector: 'app-trips-list',
  standalone: true,
  imports: [TableModule, ButtonModule, DatePipe, RouterLink],
  templateUrl: './trips-list.component.html',
})
export class TripsListComponent implements OnInit {
  private readonly trips = inject(TripsService);

  readonly allTrips = this.trips.trips;

  async ngOnInit(): Promise<void> {
    await this.trips.loadTrips();
  }

  async onDelete(tripId: string): Promise<void> {
    if (!window.confirm('Delete this trip?')) {
      return;
    }
    await this.trips.deleteTrip(tripId);
  }
}
