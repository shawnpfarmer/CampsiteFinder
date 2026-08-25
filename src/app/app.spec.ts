import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { vi } from 'vitest';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { SupabaseService } from './core/services/supabase.service';
import { UserService } from './core/services/user.service';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('bootstraps the profile (and its persisted theme) when a session already exists', () => {
    const loadProfile = vi.fn().mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        {
          provide: SupabaseService,
          useValue: { session: signal({ user: { id: 'user-1' } }), client: { auth: { signOut: vi.fn() } } },
        },
        { provide: UserService, useValue: { loadProfile } },
      ],
    });

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    TestBed.tick();

    expect(loadProfile).toHaveBeenCalled();
  });
});
