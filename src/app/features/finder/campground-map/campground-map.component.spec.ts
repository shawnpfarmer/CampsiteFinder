import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CampgroundMapComponent } from './campground-map.component';

describe('CampgroundMapComponent', () => {
  let fixture: ComponentFixture<CampgroundMapComponent>;
  let component: CampgroundMapComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [CampgroundMapComponent] });
    fixture = TestBed.createComponent(CampgroundMapComponent);
    component = fixture.componentInstance;
  });

  it('creates one marker layer per campground', () => {
    component.campgrounds = [
      { id: '1', lat: 44.3, lng: -68.2, name: 'A' } as any,
      { id: '2', lat: 45.0, lng: -69.0, name: 'B' } as any,
    ];
    component.ngOnChanges({ campgrounds: {} as any });

    expect(component.markerLayers.length).toBe(2);
  });

  it('does not add a route line when ordered is false', () => {
    component.campgrounds = [
      { id: '1', lat: 44.3, lng: -68.2, name: 'A' } as any,
      { id: '2', lat: 45.0, lng: -69.0, name: 'B' } as any,
    ];
    component.ngOnChanges({ campgrounds: {} as any });

    expect(component.markerLayers.length).toBe(2);
  });

  it('numbers markers and adds a connecting route line when ordered is true', () => {
    component.campgrounds = [
      { id: '1', lat: 44.3, lng: -68.2, name: 'A' } as any,
      { id: '2', lat: 45.0, lng: -69.0, name: 'B' } as any,
    ];
    component.ordered = true;
    component.ngOnChanges({ campgrounds: {} as any, ordered: {} as any });

    expect(component.markerLayers.length).toBe(3);
  });

  it('does not add a route line for a single-stop ordered trip', () => {
    component.campgrounds = [{ id: '1', lat: 44.3, lng: -68.2, name: 'A' } as any];
    component.ordered = true;
    component.ngOnChanges({ campgrounds: {} as any, ordered: {} as any });

    expect(component.markerLayers.length).toBe(1);
  });
});
