// Rounds and the economy: the one place that decides what a round is.
// Phases: BUY (15 s, buy menu open) -> LIVE (100 s) -> PLANTED (35 s fuse,
// driven by bomb.js) -> END (5 s banner) -> next round. First to 3, max 5.
// Money: start $900, kill +$250, round win +$300, plant +$250, loss +$150.
// A round ends on elimination, detonation, defusal, or the clock (defenders
// win on time when nothing is planted). The match ends at 3–0, 3–1, 3–2, or
// after round 5 on score.
import { WEAPON_DEFS } from './weapons.js';

export const BUY_SECONDS = 15;
export const ROUND_SECONDS = 100;
export const END_SECONDS = 5;
export const WIN_ROUNDS = 3;
export const MAX_ROUNDS = 5;
const KILL_REWARD = 250;
const WIN_REWARD = 300;
const PLANT_REWARD = 250;
const LOSS_REWARD = 150;

export function createRounds() {
  const state = {
    phase: 'BUY', // BUY | LIVE | PLANTED | END | MATCH
    phaseLeft: BUY_SECONDS,
    round: 1,
    scoreAtk: 0,
    scoreDef: 0,
    money: 900,
    kills: 0,
    deaths: 0,
    plants: 0,
    endReason: '',
    matchWinner: null,
  };

  function award(amount) {
    state.money += amount;
  }

  return {
    state,
    startRound() {
      state.phase = 'BUY';
      state.phaseLeft = BUY_SECONDS;
      state.endReason = '';
    },
    // Tick the clock. Returns an event string when the phase must change:
    // 'buy-over' | 'time-up' | null. The fuse is ticked by bomb.js, not here.
    tick(dt) {
      if (state.phase === 'END' || state.phase === 'MATCH') {
        state.phaseLeft -= dt;
        if (state.phaseLeft <= 0 && state.phase === 'END') return 'end-over';
        return null;
      }
      state.phaseLeft -= dt;
      if (state.phaseLeft <= 0) {
        if (state.phase === 'BUY') {
          state.phase = 'LIVE';
          state.phaseLeft = ROUND_SECONDS;
          return 'buy-over';
        }
        if (state.phase === 'LIVE') return 'time-up';
      }
      return null;
    },
    onPlant() {
      state.phase = 'PLANTED';
      state.phaseLeft = 35;
      state.plants += 1;
      award(PLANT_REWARD);
    },
    onKill(headshot) {
      state.kills += 1;
      award(KILL_REWARD);
    },
    onDeath() {
      state.deaths += 1;
    },
    // End the round for one side. Returns { winner, reason, matchOver }.
    endRound(winner, reason) {
      state.endReason = reason;
      if (winner === 'attackers') state.scoreAtk += 1;
      else state.scoreDef += 1;
      award(winner === 'attackers' ? WIN_REWARD : LOSS_REWARD);
      state.phase = 'END';
      state.phaseLeft = END_SECONDS;
      const matchOver =
        state.scoreAtk >= WIN_ROUNDS || state.scoreDef >= WIN_ROUNDS || state.round >= MAX_ROUNDS;
      if (matchOver) state.matchWinner = state.scoreAtk > state.scoreDef ? 'attackers' : 'defenders';
      return { winner, reason, matchOver };
    },
    nextRound() {
      if (state.matchWinner) {
        state.phase = 'MATCH';
        return false;
      }
      state.round += 1;
      state.phase = 'BUY';
      state.phaseLeft = BUY_SECONDS;
      state.endReason = '';
      return true;
    },
    // Buy menu: weapons by key, grenades by key. Returns a result string.
    buy(key, weapons, grenades) {
      if (state.phase !== 'BUY') return 'not-buy-phase';
      const map = { Digit1: 'smg', Digit2: 'rifle', Digit3: 'marksman', Digit4: 'smoke', Digit5: 'flash' };
      const item = map[key];
      if (!item) return null;
      if (item === 'smoke' || item === 'flash') {
        const price = item === 'smoke' ? 250 : 150;
        if (state.money < price) return 'too-poor';
        state.money -= price;
        grenades.buy(item);
        return `bought-${item}`;
      }
      const def = WEAPON_DEFS[item];
      if (weapons.state.owned[item]) {
        weapons.switchTo(item);
        return `switched-${item}`;
      }
      if (state.money < def.price) return 'too-poor';
      state.money -= def.price;
      weapons.buy(item);
      return `bought-${item}`;
    },
  };
}
