import { Component, Input } from '@angular/core';
import { Card } from '../../models/game-state.model';

@Component({
  selector: 'app-card',
  templateUrl: './card.component.html',
  styleUrls: ['./card.component.scss'],
})
export class CardComponent {
  @Input() card!: Card;
  @Input() clickable = false;
  @Input() selected = false;
  @Input() isDrawn = false;
  @Input() compact = false;

  getSuitSymbol(): string {
    const symbols: { [key: string]: string } = {
      hearts: '♥',
      diamonds: '♦',
      clubs: '♣',
      spades: '♠',
    };
    return symbols[this.card.suit] || '';
  }

  getSuitColor(): string {
    return this.card.suit === 'hearts' || this.card.suit === 'diamonds' ? 'red' : 'black';
  }

  isFaceCard(): boolean {
    return ['J', 'Q', 'K'].includes(this.card.rank);
  }

  getFaceSymbol(): string {
    const red = this.getSuitColor() === 'red';
    const map: Record<string, [string, string]> = {
      K: ['♔', '♚'],
      Q: ['♕', '♛'],
      J: ['♘', '♞'],
    };
    const pair = map[this.card.rank];
    return pair ? (red ? pair[0] : pair[1]) : '';
  }
}
