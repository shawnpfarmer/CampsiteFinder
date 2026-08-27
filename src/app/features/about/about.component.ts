import { Component } from '@angular/core';

interface Star {
  id: number;
  x: number;
  y: number;
  r: number;
  twinkle: boolean;
  delay: number;
}

interface Tree {
  id: number;
  points: string;
}

interface Ember {
  id: number;
  x: number;
  r: number;
  delay: number;
}

const STAR_COUNT = 40;
const TREE_COUNT = 20;
const GROUND_Y = 392;

function buildStars(): Star[] {
  return Array.from({ length: STAR_COUNT }, (_, i) => ({
    id: i,
    x: (i * 137.5) % 1200,
    y: 20 + ((i * 71) % 260),
    r: 1 + (i % 3) * 0.5,
    twinkle: i % 5 === 0,
    delay: (i % 7) * 300,
  }));
}

function buildTrees(): Tree[] {
  return Array.from({ length: TREE_COUNT }, (_, i) => {
    const x = 20 + i * 62;
    const height = 40 + ((i * 37) % 55);
    const width = 28 + (i % 4) * 6;
    const points = `${x},${GROUND_Y - height} ${x - width / 2},${GROUND_Y} ${x + width / 2},${GROUND_Y}`;
    return { id: i, points };
  });
}

function buildEmbers(): Ember[] {
  return Array.from({ length: 6 }, (_, i) => ({
    id: i,
    x: 420 + ((i * 13) % 22),
    r: 1.5 + (i % 2),
    delay: i * 450,
  }));
}

@Component({
  selector: 'app-about',
  standalone: true,
  templateUrl: './about.component.html',
  styleUrl: './about.component.scss',
})
export class AboutComponent {
  readonly adminEmail = 'shawnpfarmer@gmail.com';
  readonly stars = buildStars();
  readonly trees = buildTrees();
  readonly embers = buildEmbers();
}
