import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CampgroundsService } from '../../core/services/campgrounds.service';
import { FavoriteToggleComponent } from '../../shared/favorite-toggle/favorite-toggle.component';
import { Campground } from '../../core/models/campground.model';

@Component({
  selector: 'app-campground-detail',
  standalone: true,
  imports: [FavoriteToggleComponent],
  templateUrl: './campground-detail.component.html',
})
export class CampgroundDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly campgroundsService = inject(CampgroundsService);

  readonly campground = signal<Campground | null>(null);
  readonly notFound = signal(false);

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.notFound.set(true);
      return;
    }
    try {
      const results = await this.campgroundsService.getByIds([id]);
      if (results.length === 0) {
        this.notFound.set(true);
        return;
      }
      this.campground.set(results[0]);
    } catch {
      this.notFound.set(true);
    }
  }
}
