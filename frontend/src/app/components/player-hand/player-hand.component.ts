import { Component, Input, Output, EventEmitter, OnChanges, OnInit, SimpleChanges } from '@angular/core';
import { Card } from '../../models/game-state.model';

@Component({
  selector: 'app-player-hand',
  templateUrl: './player-hand.component.html',
  styleUrls: ['./player-hand.component.scss'],
})
export class PlayerHandComponent implements OnInit, OnChanges {
  @Input() cards: Card[] = [];
  @Input() drawnCard: Card | null = null;
  @Input() drawSource: 'stockpile' | 'discard' | null = null;
  @Input() selectedIndices: number[] = [];
  @Input() disabled = false;
  @Input() canSelect = false;
  @Input() turnPhase = '';
  @Output() cardSelected = new EventEmitter<number>();
  @Output() autoDiscard = new EventEmitter<number[]>(); // Auto-confirm discard
  @Output() dragStateChange = new EventEmitter<boolean>();

  discardingIndex: number | null = null;
  pairedCards: number[] = []; // indices of cards that form a pair being dragged
  draggingCardIndex: number | null = null;
  private lastPointerSelectionAt = 0;
  private lastPointerSelectionIndex = -1;

  get dragEnabled(): boolean {
    if (typeof window === 'undefined') {
      return true;
    }

    // Native HTML5 drag is unreliable on touch browsers; keep tap selection as primary there.
    return !window.matchMedia('(pointer: coarse)').matches;
  }

  ngOnInit(): void {
    // Reset pair on turn phase change
    if (this.turnPhase !== 'waiting_for_action') {
      this.pairedCards = [];
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    const turnPhaseChanged = !!changes['turnPhase'];
    const cardsChanged = !!changes['cards'];
    const canSelectChanged = !!changes['canSelect'];

    if (turnPhaseChanged || canSelectChanged) {
      const notActionPhase = this.turnPhase !== 'waiting_for_action';
      if (notActionPhase || !this.canSelect) {
        this.pairedCards = [];
        this.draggingCardIndex = null;
        this.discardingIndex = null;
      }
    }

    // Polling can replace array references every second; keep a valid pair stable.
    if (cardsChanged && this.pairedCards.length === 2) {
      const [first, second] = this.pairedCards;
      const firstCard = this.cards[first];
      const secondCard = this.cards[second];
      if (!firstCard || !secondCard || firstCard.rank !== secondCard.rank) {
        this.pairedCards = [];
      }
    }
  }

  // Check if a card can pair with another (same rank)
  canPairWith(index1: number, index2: number): boolean {
    if (index1 === index2) return false;
    return this.cards[index1].rank === this.cards[index2].rank;
  }

  // Handle drag start
  onDragStarted(index: number, event: any): void {
    if (!this.canSelect || this.disabled) {
      event.preventDefault();
      return;
    }
    this.draggingCardIndex = index;
    this.dragStateChange.emit(true);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', 'card');
    event.dataTransfer.setData('cardIndex', String(index));
    // Set drag data for dropping on table
    if (this.pairedCards.length === 2) {
      // Dragging a pair
      event.dataTransfer.setData('cardIndices', JSON.stringify(this.pairedCards));
    } else {
      // Dragging single card
      event.dataTransfer.setData('cardIndices', JSON.stringify([index]));
    }
  }

  // Handle drag over another card (detect pairing opportunity)
  onDragOver(index: number, event: any): void {
    if (this.draggingCardIndex !== null && this.canSelect && !this.disabled) {
      event.preventDefault();
    }
  }

  // Handle drop on another card (form pair or single selection)
  onCardDropped(dropIndex: number, event: DragEvent): void {
    event.preventDefault();
    
    if (this.draggingCardIndex === null || !this.canSelect || this.disabled) {
      return;
    }

    const dragIndexFromData = Number(event.dataTransfer?.getData('cardIndex'));
    const dragIndex = this.draggingCardIndex ?? (Number.isNaN(dragIndexFromData) ? null : dragIndexFromData);

    if (dragIndex === null) {
      this.pairedCards = [];
      this.draggingCardIndex = null;
      this.dragStateChange.emit(false);
      return;
    }

    if (dragIndex === dropIndex) {
      // Dropped on self - just select the single card
      this.selectCard(dragIndex);
      this.draggingCardIndex = null;
      this.pairedCards = [];
      this.dragStateChange.emit(false);
    } else if (this.canPairWith(dragIndex, dropIndex)) {
      // Pair detected
      this.pairedCards = [dragIndex, dropIndex].sort();
      this.draggingCardIndex = null;
      this.dragStateChange.emit(false);
    } else {
      // Invalid drop
      this.draggingCardIndex = null;
      this.pairedCards = [];
      this.dragStateChange.emit(false);
    }
  }

  onCardClicked(index: number): void {
    const now = Date.now();
    const wasJustHandledByPointer =
      this.lastPointerSelectionIndex === index && now - this.lastPointerSelectionAt < 450;
    if (wasJustHandledByPointer) {
      return;
    }

    if (!this.canSelect || this.disabled) {
      return;
    }

    this.cardSelected.emit(index);
  }

  onCardPointerUp(index: number, event: PointerEvent): void {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    if (!this.canSelect || this.disabled) {
      return;
    }

    event.preventDefault();
    this.lastPointerSelectionIndex = index;
    this.lastPointerSelectionAt = Date.now();
    this.cardSelected.emit(index);
  }

  // Select a single card and notify parent
  selectCard(index: number): void {
    this.cardSelected.emit(index);
  }

  // Handle drag end (when dragging stops without a drop)
  onDragEnd(): void {
    this.draggingCardIndex = null;
    this.dragStateChange.emit(false);
    // Don't clear pairedCards here - they might have been formed before drag started
  }

  // Submit the pair to be discarded
  submitPair(): void {
    if (this.pairedCards.length === 2 && this.canSelect && !this.disabled) {
      const [first, second] = this.pairedCards;
      this.discardingIndex = first;
      // Emit both indices to parent for discard
      setTimeout(() => {
        this.autoDiscard.emit([first, second]);
        this.pairedCards = [];
        this.discardingIndex = null;
        this.dragStateChange.emit(false);
      }, 40);
    }
  }

  // Cancel pair selection
  cancelPair(): void {
    this.pairedCards = [];
    this.draggingCardIndex = null;
    this.dragStateChange.emit(false);
  }

  isCardDrawn(index: number): boolean {
    return (
      this.drawnCard !== null &&
      index === this.cards.length - 1 &&
      this.cards[index] === this.drawnCard
    );
  }

  isPaired(index: number): boolean {
    return this.pairedCards.includes(index);
  }
}
