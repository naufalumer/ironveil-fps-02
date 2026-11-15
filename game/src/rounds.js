// Rounds and the economy: the one place that decides what a round is.
// Stages: BUY (15 s, shop open) -> LIVE (100 s) -> PLANTED (35 s fuse,
// driven by the charge module) -> END (5 s banner) -> next round. First
// to 3, max 5. Money: start $900, kill +$250, round win +$300, plant
// +$250, loss +$150. A round ends on elimination, detonation, defusal,
// or the clock (defenders win on time when nothing is planted). The
// match ends at 3–0, 3–1, 3–2, or after round 5 on score.
import { GUNBOOK } from './weapons.js';

export const BUY_TIME = 15;
export const ROUND_TIME = 100;
export const END_TIME = 5;
export const ROUNDS_TO_WIN = 3;
export const ROUND_CAP = 5;
const KILL_PAY = 250;
const WIN_PAY = 300;
const PLANT_PAY = 250;
const LOSS_PAY = 150;

const SHOP_KEYS = {
  Digit1: 'smg',
  Digit2: 'rifle',
  Digit3: 'marksman',
  Digit4: 'smoke',
  Digit5: 'flash',
};
const GRENADE_PRICES = { smoke: 250, flash: 150 };

export function makeMatch() {
  const state = {
    stage: 'BUY', // BUY | LIVE | PLANTED | END | MATCH
    stageLeft: BUY_TIME,
    roundNo: 1,
    atkScore: 0,
    defScore: 0,
    cash: 900,
    killCount: 0,
    deathCount: 0,
    plantCount: 0,
    endNote: '',
    matchVictor: null,
  };

  function award(amount) {
    state.cash += amount;
  }

  return {
    state,
    openRound() {
      state.stage = 'BUY';
      state.stageLeft = BUY_TIME;
      state.endNote = '';
    },
    // Tick the clock. Returns an event string when the stage must change:
    // 'buy-over' | 'time-up' | 'end-over' | null. The fuse is ticked by
    // the charge module, not here.
    advance(dt) {
      if (state.stage === 'END' || state.stage === 'MATCH') {
        state.stageLeft -= dt;
        if (state.stageLeft <= 0 && state.stage === 'END') return 'end-over';
        return null;
      }
      state.stageLeft -= dt;
      if (state.stageLeft <= 0) {
        if (state.stage === 'BUY') {
          state.stage = 'LIVE';
          state.stageLeft = ROUND_TIME;
          return 'buy-over';
        }
        if (state.stage === 'LIVE') return 'time-up';
      }
      return null;
    },
    notePlant() {
      state.stage = 'PLANTED';
      state.stageLeft = 35;
      state.plantCount += 1;
      award(PLANT_PAY);
    },
    noteKill() {
      state.killCount += 1;
      award(KILL_PAY);
    },
    noteDeath() {
      state.deathCount += 1;
    },
    // End the round for one side. Returns { winner, reason, matchOver }.
    closeRound(winner, reason) {
      state.endNote = reason;
      if (winner === 'attackers') state.atkScore += 1;
      else state.defScore += 1;
      award(winner === 'attackers' ? WIN_PAY : LOSS_PAY);
      state.stage = 'END';
      state.stageLeft = END_TIME;
      const matchOver =
        state.atkScore >= ROUNDS_TO_WIN ||
        state.defScore >= ROUNDS_TO_WIN ||
        state.roundNo >= ROUND_CAP;
      if (matchOver) {
        state.matchVictor =
          state.atkScore > state.defScore ? 'attackers' : 'defenders';
      }
      return { winner, reason, matchOver };
    },
    next() {
      if (state.matchVictor) {
        state.stage = 'MATCH';
        return false;
      }
      state.roundNo += 1;
      state.stage = 'BUY';
      state.stageLeft = BUY_TIME;
      state.endNote = '';
      return true;
    },
    // Shop: weapons by key, grenades by key. Returns a result string.
    purchase(key, arsenal, kit) {
      if (state.stage !== 'BUY') return 'not-buy-phase';
      const item = SHOP_KEYS[key];
      if (!item) return null;
      if (item === 'smoke' || item === 'flash') {
        const price = GRENADE_PRICES[item];
        if (state.cash < price) return 'too-poor';
        state.cash -= price;
        kit.stock(item);
        return `bought-${item}`;
      }
      const spec = GUNBOOK[item];
      if (arsenal.state.unlocked[item]) {
        arsenal.equip(item);
        return `switched-${item}`;
      }
      if (state.cash < spec.cost) return 'too-poor';
      state.cash -= spec.cost;
      arsenal.purchase(item);
      return `bought-${item}`;
    },
  };
}
