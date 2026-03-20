import { Component, EventEmitter, Input, Output } from '@angular/core';
import { GameState } from '../../models/game-state.model';

@Component({
  selector: 'app-game-controls',
  templateUrl: './game-controls.component.html',
  styleUrls: ['./game-controls.component.scss'],
})
export class GameControlsComponent {
  @Input() gameState!: GameState;
  @Input() isCurrentPlayer = false;
  @Input() canCallDhumbal = false;
  @Input() canEndTurn = false;
  @Input() showEndTurnButton = true;
  @Input() isLoading = false;
  @Input() error = '';
  @Output() callDhumbal = new EventEmitter<void>();
  @Output() endTurn = new EventEmitter<void>();

  onCallDhumbal(): void {
    if (this.canCallDhumbal) {
      this.callDhumbal.emit();
    }
  }

  onEndTurn(): void {
    if (this.canEndTurn) {
      this.endTurn.emit();
    }
  }
}
