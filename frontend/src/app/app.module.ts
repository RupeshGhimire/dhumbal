import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { HttpClientModule } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { DragDropModule } from '@angular/cdk/drag-drop';

import { AppComponent } from './app.component';
import { GameBoardComponent } from './components/game-board/game-board.component';
import { PlayerHandComponent } from './components/player-hand/player-hand.component';
import { GameControlsComponent } from './components/game-controls/game-controls.component';
import { GameSetupComponent } from './components/game-setup/game-setup.component';
import { GameOverComponent } from './components/game-over/game-over.component';
import { CardComponent } from './components/card/card.component';

@NgModule({
  declarations: [
    AppComponent,
    GameBoardComponent,
    PlayerHandComponent,
    GameControlsComponent,
    GameSetupComponent,
    GameOverComponent,
    CardComponent,
  ],
  imports: [BrowserModule, CommonModule, BrowserAnimationsModule, HttpClientModule, FormsModule, ReactiveFormsModule, DragDropModule],
  providers: [],
  bootstrap: [AppComponent],
})
export class AppModule {}
