import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
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

  it('fits the viewport to the whole route when ordered and the map is ready', () => {
    const fitBounds = vi.fn();
    const setView = vi.fn();
    component.onMapReady({ fitBounds, setView } as any);
    component.campgrounds = [
      { id: '1', lat: 44.3, lng: -68.2, name: 'A' } as any,
      { id: '2', lat: 45.0, lng: -69.0, name: 'B' } as any,
    ];
    component.ordered = true;

    component.ngOnChanges({ campgrounds: {} as any, ordered: {} as any });

    expect(fitBounds).toHaveBeenCalledTimes(1);
    const [bounds, options] = fitBounds.mock.calls[0];
    expect(bounds.getSouth()).toBe(44.3);
    expect(bounds.getNorth()).toBe(45.0);
    expect(bounds.getWest()).toBe(-69.0);
    expect(bounds.getEast()).toBe(-68.2);
    expect(options).toEqual({ padding: [32, 32] });
  });

  it('fits the viewport for a single-stop ordered trip too', () => {
    const fitBounds = vi.fn();
    component.onMapReady({ fitBounds, setView: vi.fn() } as any);
    component.campgrounds = [{ id: '1', lat: 44.3, lng: -68.2, name: 'A' } as any];
    component.ordered = true;

    component.ngOnChanges({ campgrounds: {} as any, ordered: {} as any });

    expect(fitBounds).toHaveBeenCalledTimes(1);
  });

  it('does not fit the viewport when not in ordered mode', () => {
    const fitBounds = vi.fn();
    component.onMapReady({ fitBounds, setView: vi.fn() } as any);
    component.campgrounds = [
      { id: '1', lat: 44.3, lng: -68.2, name: 'A' } as any,
      { id: '2', lat: 45.0, lng: -69.0, name: 'B' } as any,
    ];

    component.ngOnChanges({ campgrounds: {} as any });

    expect(fitBounds).not.toHaveBeenCalled();
  });

  it('does not fit the viewport for an ordered trip with no stops', () => {
    const fitBounds = vi.fn();
    component.onMapReady({ fitBounds, setView: vi.fn() } as any);
    component.campgrounds = [];
    component.ordered = true;

    component.ngOnChanges({ campgrounds: {} as any, ordered: {} as any });

    expect(fitBounds).not.toHaveBeenCalled();
  });

  it('does not throw when the map is not ready yet on the first change', () => {
    component.campgrounds = [
      { id: '1', lat: 44.3, lng: -68.2, name: 'A' } as any,
      { id: '2', lat: 45.0, lng: -69.0, name: 'B' } as any,
    ];
    component.ordered = true;

    expect(() =>
      component.ngOnChanges({ campgrounds: {} as any, ordered: {} as any }),
    ).not.toThrow();
    expect(component.markerLayers.length).toBe(3);
  });
});
