import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CampgroundTableComponent } from './campground-table.component';

describe('CampgroundTableComponent', () => {
  let fixture: ComponentFixture<CampgroundTableComponent>;
  let component: CampgroundTableComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [CampgroundTableComponent] });
    fixture = TestBed.createComponent(CampgroundTableComponent);
    component = fixture.componentInstance;
  });

  it('emits selectedChange when a row is selected', () => {
    const campground = { id: '1', name: 'A' } as any;
    let emitted: any;
    component.selectedChange.subscribe((c) => (emitted = c));

    component.onSelectionChange(campground);

    expect(emitted).toBe(campground);
  });
});
