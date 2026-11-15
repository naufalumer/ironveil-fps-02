// The DOM HUD: crosshair, hit marker, health, ammo, timer, score,
// money, killfeed, charge status, buy menu and the overlay panels. It
// never touches the simulation; main.js pushes numbers in and reads the
// play callback out. Every setter is cheap and cached: unchanged values
// never touch the DOM.
import { GUNBOOK } from './weapons.js';

const PANELS = {
  start: {
    title: 'IRONVEIL',
    copy: 'Foundry breach. Plant the charge at A or B, or wipe the defenders. First to 3 rounds takes the foundry.',
    action: 'Click to play',
  },
  paused: { title: 'IRONVEIL', copy: 'Paused. Click to resume.', action: 'Click to resume' },
  dead: { title: 'You are down', copy: 'Your squad fights on. Next round starts soon.', action: 'Spectate' },
};

const SHOP_ROWS = [
  { key: '1', id: 'smg' },
  { key: '2', id: 'rifle' },
  { key: '3', id: 'marksman' },
  { key: '4', id: 'smoke', label: 'Smoke grenade', price: 250 },
  { key: '5', id: 'flash', label: 'Flash grenade', price: 150 },
];

export function makeHud() {
  const $ = (id) => document.getElementById(id);
  const veil = $('veil');
  const veilTitle = $('veil-title');
  const veilCopy = $('veil-copy');
  const playBtn = $('play-btn');
  const hpFill = $('hp-fill');
  const hpNum = $('hp-num');
  const magNum = $('mag-num');
  const spareNum = $('spare-num');
  const gunName = $('gun-name');
  const cashNum = $('cash-num');
  const clockNum = $('clock-num');
  const scoreA = $('score-a');
  const scoreD = $('score-d');
  const roundNum = $('round-num');
  const feed = $('feed');
  const hitmark = $('hitmark');
  const sight = $('sight');
  const chargeStatus = $('charge-status');
  const shop = $('shop');
  const shopList = $('shop-list');
  const flag = $('flag');
  const flagTitle = $('flag-title');
  const flagSub = $('flag-sub');
  const clue = $('clue');
  const kitLine = $('kit-line');
  const hurtVignette = $('hurt-vignette');
  const carrying = $('carrying');

  let last = {};
  let hitTimer = 0;
  let flagTimer = 0;

  function putText(el, key, value) {
    if (last[key] === value) return;
    last[key] = value;
    el.textContent = value;
  }

  // Build the shop rows once; update prices/owned state per render.
  const shopRows = {};
  for (const item of SHOP_ROWS) {
    const spec = GUNBOOK[item.id];
    const label = item.label ?? spec.label;
    const price = item.price ?? spec.cost;
    const li = document.createElement('li');
    li.innerHTML = `<kbd>${item.key}</kbd><span>${label}</span><b>$${price}</b>`;
    shopList.appendChild(li);
    shopRows[item.id] = { li, price };
  }

  return {
    showHp(value) {
      const v = Math.max(0, Math.round(value));
      if (last.hp === v) return;
      last.hp = v;
      hpFill.style.width = `${v}%`;
      hpFill.classList.toggle('critical', v <= 30);
      hpNum.textContent = String(v);
      hurtVignette.style.opacity = v <= 30 ? String(((30 - v) / 30) * 0.55) : '0';
    },
    showLoads(clip, spare, gunKey) {
      putText(magNum, 'clip', String(clip));
      putText(spareNum, 'spare', `/ ${spare}`);
      putText(gunName, 'gun', GUNBOOK[gunKey].label);
      $('ammo-box').classList.toggle('dry', clip === 0);
    },
    showCash(value) {
      putText(cashNum, 'cash', `$${value}`);
    },
    showKit(smokes, flashes, chosen) {
      putText(
        kitLine,
        'kit',
        `Smoke ${smokes} · Flash ${flashes} — [4]/[5] select, [G] throw (${chosen})`,
      );
    },
    showClock(seconds, stage) {
      const s = Math.max(0, Math.ceil(seconds));
      const text =
        stage === 'BUY'
          ? `BUY ${s}`
          : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      putText(clockNum, 'clock', text);
      $('clock').classList.toggle('shopping', stage === 'BUY');
      $('clock').classList.toggle('late', stage !== 'BUY' && s <= 10);
    },
    showScore(atk, def, round) {
      putText(scoreA, 'atk', String(atk));
      putText(scoreD, 'def', String(def));
      putText(roundNum, 'round', `ROUND ${round} / 5`);
    },
    setSightGap(px) {
      const v = Math.round(px);
      if (last.gap === v) return;
      last.gap = v;
      sight.style.setProperty('--gap', `${v}px`);
    },
    markHit(killed, holdMs = 90) {
      hitmark.classList.add('lit');
      hitmark.classList.toggle('fatal', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(
        () => hitmark.classList.remove('lit', 'fatal'),
        holdMs,
      );
    },
    addKill(killer, victim, headshot, killerTeam) {
      const row = document.createElement('div');
      row.className = `feed-line ${killerTeam}`;
      row.innerHTML = `<b>${killer}</b> ${headshot ? '◎' : '—'} <b>${victim}</b>`;
      feed.prepend(row);
      while (feed.children.length > 5) feed.removeChild(feed.lastChild);
      setTimeout(() => row.remove(), 6000);
    },
    hurtFrom(angleDeg) {
      const arc = document.createElement('div');
      arc.className = 'hurt-arc';
      arc.style.transform = `rotate(${angleDeg}deg)`;
      $('hurt-dir').appendChild(arc);
      setTimeout(() => arc.remove(), 900);
    },
    showCharge(text, kind) {
      putText(chargeStatus, 'charge', text);
      chargeStatus.className = kind ? `open ${kind}` : '';
    },
    showCarrying(show) {
      carrying.classList.toggle('open', show);
    },
    showClue(text) {
      putText(clue, 'clue', text);
      clue.classList.toggle('open', !!text);
    },
    showShop(show, money, unlocked) {
      shop.classList.toggle('open', show);
      if (!show) return;
      for (const item of SHOP_ROWS) {
        const row = shopRows[item.id];
        const afford = money >= row.price;
        const has =
          item.id === 'smoke' || item.id === 'flash'
            ? false
            : !!unlocked[item.id];
        row.li.classList.toggle('poor', !afford);
        row.li.classList.toggle('have', has);
      }
    },
    showFlag(titleText, subText, kind, ms = 2600) {
      flagTitle.textContent = titleText;
      flagSub.textContent = subText;
      flag.className = `open ${kind || ''}`;
      clearTimeout(flagTimer);
      flagTimer = setTimeout(() => {
        flag.className = '';
      }, ms);
    },
    showVeil(mode, data) {
      const text = PANELS[mode];
      if (!text) return;
      veilTitle.textContent = text.title;
      veilCopy.textContent = mode === 'dead' && data ? `${text.copy}` : text.copy;
      playBtn.textContent = text.action;
      veil.hidden = false;
      playBtn.focus();
    },
    showMatchVeil(won, atk, def) {
      veilTitle.textContent = won ? 'FOUNDRY TAKEN' : 'FOUNDRY LOST';
      veilCopy.textContent = `Final score — Attackers ${atk} · Defenders ${def}. ${won ? 'The charge did its work.' : 'The defenders held the foundry.'}`;
      playBtn.textContent = 'Play again';
      veil.hidden = false;
      playBtn.focus();
    },
    hideVeil() {
      veil.hidden = true;
    },
    onPlayClick(handler) {
      playBtn.addEventListener('click', handler);
    },
  };
}
